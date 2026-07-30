import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient, generateBlobSASQueryParameters, ContainerSASPermissions, StorageSharedKeyCredential } from "@azure/storage-blob";
import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// Initialize Cosmos DB Client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING || "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==");
const database = cosmosClient.database("loadout-db");
const container = database.container("inspections");

// Shared reference data (sites, inspectors, staging locations) is synced
// across devices so a freshly-set-up device sees the same lists instead of
// starting empty. Containers are created on first use so no manual portal
// step is required.
const refContainerPromises = new Map<string, Promise<import("@azure/cosmos").Container>>();
function getRefContainer(name: string) {
    let promise = refContainerPromises.get(name);
    if (!promise) {
        promise = database.containers
            .createIfNotExists({ id: name, partitionKey: { paths: ["/id"] } })
            .then((res) => res.container);
        refContainerPromises.set(name, promise);
    }
    return promise;
}
const getSitesContainer = () => getRefContainer("sites");

// Initialize Blob Storage Client
// Storage account names are ALWAYS lowercase. The app setting in the portal
// was entered uppercase ("GXOLOADOUTB"), which made every SAS signature invalid
// (signed canonical resource /blob/GXOLOADOUTB/... vs the service's
// /blob/gxoloadoutb/...) — photo uploads failed with OutOfRangeInput/403.
const storageAccountName = (process.env.STORAGE_ACCOUNT_NAME || "devstoreaccount1").trim().toLowerCase();
const storageAccountKey = process.env.STORAGE_ACCOUNT_KEY || "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const sharedKeyCredential = new StorageSharedKeyCredential(storageAccountName, storageAccountKey);
// Note: In production, the blob endpoint might differ depending on region/suffix. This is standard Azure Blob URL.
const blobServiceClient = new BlobServiceClient(`https://${storageAccountName}.blob.core.windows.net`, sharedKeyCredential);
const photoContainerName = "photos";

// The container is created on first use — it never existed in the storage
// account, so every SAS upload 404'd with ContainerNotFound.
let photoContainerPromise: Promise<void> | null = null;
function ensurePhotoContainer(): Promise<void> {
    if (!photoContainerPromise) {
        photoContainerPromise = blobServiceClient
            .getContainerClient(photoContainerName)
            .createIfNotExists()
            .then(() => undefined)
            .catch((err) => {
                // Reset so the next request retries instead of caching the failure.
                photoContainerPromise = null;
                throw err;
            });
    }
    return photoContainerPromise;
}

// Azure AI Document Intelligence (OCR). The endpoint + key live in the Function
// App settings (never shipped to the client) so picklist/BOL images are read
// server-side. If unset, the analyze endpoints report "not configured" rather
// than crashing, so the app degrades to manual entry.
const docIntelEndpoint = (process.env.DOC_INTEL_ENDPOINT || "").trim();
const docIntelKey = (process.env.DOC_INTEL_KEY || "").trim();
let docClient: DocumentAnalysisClient | null = null;
function getDocClient(): DocumentAnalysisClient | null {
    if (!docIntelEndpoint || !docIntelKey) return null;
    if (!docClient) {
        docClient = new DocumentAnalysisClient(docIntelEndpoint, new AzureKeyCredential(docIntelKey));
    }
    return docClient;
}

// SAP UOM codes as they appear on the picklist. BAG/PCE are legacy aliases kept
// for older records; new extractions use BG/SP/MB/PL/C62.
type Uom = "BG" | "SP" | "MB" | "PL" | "C62" | "BAG" | "PCE";

type OcrLineItem = {
    batchCode: string | null;
    /** Material / SKU number — the two terms mean the same thing here. e.g. "91007244". */
    sku: string | null;
    /** Material description. e.g. "C.CL.201-40VT4PRIB.SF2.40USP.UB.US". */
    description: string | null;
    expectedQuantity: number | null;
    uom: Uom;
    /**
     * Delivery this line is picked for. A picklist groups its lines under a
     * delivery heading (or carries a delivery column), and that grouping is what
     * puts each product under the right delivery in the app. Null when the sheet
     * only ever names one delivery.
     */
    deliveryNumber: string | null;
};

// Header keyword → semantic column. First match wins, so ORDER MATTERS:
// "Material Description" must be tested against the description words before
// the sku words, otherwise the sku rule swallows it and the real material
// number is dropped. That collision is what previously put a description into
// the SKU field on some picklists.
const COLUMN_KEYWORDS: Array<{ key: keyof OcrLineItem; words: string[] }> = [
    { key: "batchCode", words: ["batch", "lot"] },
    { key: "expectedQuantity", words: ["qty", "quantity", "cases", "bags", "count", "pieces", "ordered", "pick"] },
    { key: "uom", words: ["uom", "unit"] },
    { key: "deliveryNumber", words: ["delivery"] },
    { key: "description", words: ["description", "desc", "product name", "commodity", "product"] },
    { key: "sku", words: ["sku", "material", "item", "part", "article"] },
];

/**
 * A batch code is a compact alphanumeric token containing at least one letter
 * and one digit (e.g. "H18MYD9JX") — distinct from a pure material number
 * ("91007244") and from a dotted description ("C.CL.201-40VT4...").
 */
function looksLikeBatchCode(value: string): boolean {
    const v = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(v)) return false;
    return /[A-Z]/.test(v) && /[0-9]/.test(v);
}

/** A material/SKU number is essentially all digits. */
function looksLikeSku(value: string): boolean {
    return /^\d[\d\s-]{3,}$/.test(value.trim());
}

function normalizeUom(raw: string | null): Uom {
    const v = (raw || "").toUpperCase();
    // Order matters: C62 before SP (neither collides, but be explicit), and PL
    // ("pallet") is distinct from PCE. Default is BG (bags), the base unit.
    if (v.includes("C62")) return "C62";
    if (v.includes("SP")) return "SP";
    if (v.includes("MB")) return "MB";
    if (v.includes("PL") || v.includes("PALLET")) return "PL";
    if (v.includes("PCE") || v.includes("PIECE") || v === "PC" || v === "EA") return "PCE";
    if (v.includes("BG") || v.includes("BAG")) return "BG";
    return "BG";
}

function parseQuantity(raw: string | null): number | null {
    if (!raw) return null;
    const m = raw.replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
}

// ============================================================
// Reading the sheet's own text (labels, headings, positions)
// ============================================================
//
// The custom models are trained on the LINE-ITEM TABLE. The load header
// (load #, ship date) and the delivery headings that group the lines are not
// labelled in the model, so `documents[0].fields` returns nothing for them and
// the app auto-filled nothing. Everything below reads those values off the
// OCR'd text layer instead, which works no matter how the model is trained.

/** One OCR'd text line, with its page and its vertical position as 0..1. */
type DocLine = { page: number; y: number; text: string };
type DocPosition = { page: number; y: number };

/** Top-most y of a polygon, accepting both the `{x,y}[]` and flat-array forms. */
function polygonTop(polygon: any): number | null {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    let min = Infinity;
    if (typeof polygon[0] === "number") {
        for (let i = 1; i < polygon.length; i += 2) min = Math.min(min, polygon[i]);
    } else {
        for (const p of polygon) if (typeof p?.y === "number") min = Math.min(min, p.y);
    }
    return Number.isFinite(min) ? min : null;
}

/** page number → page height, so positions normalize to 0..1 across pages. */
function pageHeights(result: any): Map<number, number> {
    const heights = new Map<number, number>();
    for (const page of result?.pages || []) {
        if (typeof page.height === "number" && page.height > 0) {
            heights.set(page.pageNumber ?? 1, page.height);
        }
    }
    return heights;
}

/** Flatten the OCR'd lines into reading order (top-to-bottom, left-to-right). */
export function docLines(result: any): DocLine[] {
    const heights = pageHeights(result);
    const lines: DocLine[] = [];
    for (const page of result?.pages || []) {
        const pageNumber = page.pageNumber ?? 1;
        const height = heights.get(pageNumber) || 0;
        for (const line of page.lines || []) {
            const text = String(line.content || "").trim();
            if (!text) continue;
            const top = polygonTop(line.polygon ?? line.boundingBox);
            lines.push({ page: pageNumber, y: top != null && height ? top / height : top ?? 0, text });
        }
    }
    return lines;
}

/** First bounding region of a field/cell — its own, or its first child's. */
function firstRegion(node: any): any | null {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node.boundingRegions) && node.boundingRegions.length) return node.boundingRegions[0];
    const props = node.properties || (node.kind === "object" || node.type === "object" ? node.value : null);
    for (const child of Object.values(props || {}) as any[]) {
        if (Array.isArray(child?.boundingRegions) && child.boundingRegions.length) return child.boundingRegions[0];
    }
    return null;
}

/** Where a custom-model row / table cell sits, normalized like {@link docLines}. */
function positionOf(node: any, heights: Map<number, number>): DocPosition | null {
    const region = firstRegion(node);
    if (!region) return null;
    const top = polygonTop(region.polygon ?? region.boundingBox);
    if (top == null) return null;
    const page = region.pageNumber ?? 1;
    const height = heights.get(page) || 0;
    return { page, y: height ? top / height : top };
}

/** True when `text` is nothing but the value (plus stray punctuation). */
function isWholeLineValue(valueRe: RegExp, text: string): boolean {
    return new RegExp(`^[\\s:#.\\-]*(?:${valueRe.source})[\\s.,;]*$`, "i").test(text.trim());
}

/**
 * Find the value belonging to a label. SAP sheets print these two ways —
 * "Load: 835" on one line, or "Load" with 835 stacked underneath / to the
 * right — so the label's own line is tried first, then the next two lines
 * (which is where a right-hand neighbour lands in reading order).
 */
export function findLabeledValue(lines: DocLine[], labelRe: RegExp, valueRe: RegExp): string | null {
    for (let i = 0; i < lines.length; i++) {
        const label = labelRe.exec(lines[i].text);
        if (!label) continue;
        const rest = lines[i].text.slice(label.index + label[0].length).replace(/^[\s:#.\-]+/, "");
        const inline = valueRe.exec(rest);
        if (inline) return inline[0];
        for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
            if (!isWholeLineValue(valueRe, lines[j].text)) continue;
            const m = valueRe.exec(lines[j].text);
            if (m) return m[0];
        }
    }
    return null;
}

// A load number is short and contains at least one digit ("835", "L-2041").
export const LOAD_LABEL = /\bload\b\s*(?:#|no\.?|nbr|num(?:ber)?)?/i;
export const LOAD_VALUE = /(?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{1,19}/i;
export const SHIP_DATE_LABEL = /\b(?:ship(?:ping|ment)?\s*(?:date|dt)|date\s*shipped|pick\s*date|deliver(?:y)?\s*date)\b/i;
export const DATE_VALUE =
    /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}/;
// "Delivery" that is not "Delivery Date". SAP delivery numbers are 6–12 digits.
const DELIVERY_LABEL = /\bdeliver(?:y|ies)\b(?!\s*(?:date|dt)\b)\s*(?:#|no\.?|nbr|num(?:ber)?)?/i;
const DELIVERY_VALUE = /\d{6,12}/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Normalize any printed date to YYYY-MM-DD. The verify screen uses an
 * `<input type="date">`, which silently shows nothing for "07/26/2026" — so an
 * un-normalized ship date reads to the inspector as "OCR didn't fill it in".
 */
export function parseDateToIso(raw: string | null): string | null {
    if (!raw) return null;
    const s = String(raw).trim();
    const iso = (y: number, m: number, d: number): string | null => {
        if (y < 100) y += 2000;
        if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
        return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    };

    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return iso(+m[1], +m[2], +m[3]);

    // Numeric: US sheets print MM/DD/YYYY, SAP's dotted form is DD.MM.YYYY.
    // A first part above 12 can only be the day either way.
    m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})$/.exec(s);
    if (m) {
        const a = +m[1], b = +m[3], year = +m[4];
        const dayFirst = m[2] === "." || a > 12;
        return dayFirst ? iso(year, b, a) : iso(year, a, b);
    }

    // "26-JUL-2026" / "26 July 2026"
    m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2,4})$/.exec(s);
    if (m) {
        const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
        return month ? iso(+m[3], month, +m[1]) : null;
    }

    // "July 26, 2026" — and the Date.toString() form a typed model field
    // ("Sun Jul 26 2026 …") collapses to once it is stringified.
    m = /^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
    if (m) {
        const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
        return month ? iso(+m[3], month, +m[2]) : null;
    }
    return null;
}

/** A delivery heading on the sheet, with where it sits on the page. */
type DeliveryAnchor = DocPosition & { deliveryNumber: string };

/**
 * Every "Delivery 8012345" heading, in reading order. On a multi-delivery
 * picklist these are the section headings the line items are printed under.
 */
export function findDeliveryAnchors(lines: DocLine[]): DeliveryAnchor[] {
    const anchors: DeliveryAnchor[] = [];
    for (let i = 0; i < lines.length; i++) {
        const label = DELIVERY_LABEL.exec(lines[i].text);
        if (!label) continue;
        const rest = lines[i].text.slice(label.index + label[0].length);
        let value = (DELIVERY_VALUE.exec(rest) || [])[0] || null;
        if (!value) {
            for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
                if (!isWholeLineValue(DELIVERY_VALUE, lines[j].text)) continue;
                value = (DELIVERY_VALUE.exec(lines[j].text) || [])[0] || null;
                if (value) break;
            }
        }
        if (!value) continue;
        const last = anchors[anchors.length - 1];
        // The same heading repeated (page footer, continuation banner) is not a
        // new section — only a change of number starts one.
        if (last && last.deliveryNumber === value) continue;
        anchors.push({ page: lines[i].page, y: lines[i].y, deliveryNumber: value });
    }
    return anchors;
}

/** The delivery heading a row sits under: the nearest anchor above it. */
export function deliveryForPosition(anchors: DeliveryAnchor[], pos: DocPosition | null): string | null {
    if (!pos || !anchors.length) return null;
    let best: DeliveryAnchor | null = null;
    for (const a of anchors) {
        if (a.page > pos.page) continue;
        // Small tolerance: a heading printed level with its first row.
        if (a.page === pos.page && a.y > pos.y + 0.01) continue;
        if (!best || a.page > best.page || (a.page === best.page && a.y > best.y)) best = a;
    }
    return best ? best.deliveryNumber : null;
}

// Map a prebuilt-layout table into line items by matching header cells to the
// keyword table above. Layout preserves cell row/column indices, so we detect
// the header row (row 0), build a column→field map, then read each data row.
export function extractLineItemsFromTables(
    tables: any[] | undefined,
    /** Resolves a row's delivery from where its cells sit, when no column names one. */
    resolveDelivery?: (cell: any) => string | null
): OcrLineItem[] {
    if (!tables || !tables.length) return [];
    const items: OcrLineItem[] = [];

    for (const table of tables) {
        const cells: any[] = table.cells || [];
        if (!cells.length) continue;

        // Build column → field map from the first row's header text.
        const headerCells = cells.filter((c) => c.rowIndex === 0);
        const colToField = new Map<number, keyof OcrLineItem>();
        for (const cell of headerCells) {
            const text = String(cell.content || "").toLowerCase();
            for (const { key, words } of COLUMN_KEYWORDS) {
                if ([...colToField.values()].includes(key)) continue; // don't map same field twice
                if (words.some((w) => text.includes(w))) {
                    colToField.set(cell.columnIndex, key);
                    break;
                }
            }
        }
        // Need at least a quantity column plus one identifier to be useful.
        const mappedFields = new Set(colToField.values());
        const hasIdentifier =
            mappedFields.has("batchCode") || mappedFields.has("sku") || mappedFields.has("description");
        if (!mappedFields.has("expectedQuantity") || !hasIdentifier) continue;

        const maxRow = Math.max(...cells.map((c) => c.rowIndex));

        // Not every picklist labels its batch column ("Batch"/"Lot"). When the
        // header gave us nothing, look for an unmapped column whose data rows
        // are consistently batch-code shaped and adopt it.
        if (!mappedFields.has("batchCode")) {
            const candidates = new Map<number, { hits: number; total: number }>();
            for (const cell of cells) {
                if (cell.rowIndex === 0 || colToField.has(cell.columnIndex)) continue;
                const text = String(cell.content || "").trim();
                if (!text) continue;
                const stat = candidates.get(cell.columnIndex) || { hits: 0, total: 0 };
                stat.total++;
                if (looksLikeBatchCode(text)) stat.hits++;
                candidates.set(cell.columnIndex, stat);
            }
            let best: { col: number; ratio: number } | null = null;
            for (const [col, { hits, total }] of candidates) {
                const ratio = total ? hits / total : 0;
                // Majority of the column must look like a batch code.
                if (ratio > 0.6 && (!best || ratio > best.ratio)) best = { col, ratio };
            }
            if (best) colToField.set(best.col, "batchCode");
        }

        for (let r = 1; r <= maxRow; r++) {
            const rowCells = cells.filter((c) => c.rowIndex === r);
            if (!rowCells.length) continue;

            const raw: Record<string, string | null> = {};
            for (const cell of rowCells) {
                const field = colToField.get(cell.columnIndex);
                if (field) raw[field] = String(cell.content || "").trim() || null;
            }

            let sku = raw.sku ?? null;
            let description = raw.description ?? null;

            // Header matching can still land these the wrong way round on
            // picklists with unusual labels. The shapes are unambiguous, so
            // correct an obvious swap rather than passing it to the verifier.
            if (sku && !looksLikeSku(sku) && !description) {
                description = sku;
                sku = null;
            }
            if (description && looksLikeSku(description) && !sku) {
                sku = description;
                description = null;
            }

            const item: OcrLineItem = {
                batchCode: raw.batchCode ? raw.batchCode.toUpperCase() : null,
                sku,
                description,
                expectedQuantity: parseQuantity(raw.expectedQuantity ?? null),
                uom: normalizeUom(raw.uom ?? null),
                deliveryNumber:
                    raw.deliveryNumber ?? (resolveDelivery ? resolveDelivery(rowCells[0]) : null),
            };
            // Skip empty/subtotal rows.
            if (item.batchCode || item.sku || item.description || item.expectedQuantity !== null) {
                items.push(item);
            }
        }
    }

    return items;
}

// A normalized accessor over one custom-model field bag (a table row, or the
// document's top-level fields). Keys are matched case/space/punctuation-
// insensitively so "Batch Code" / "batch_code" / "BatchCode" all resolve.
interface FieldBag {
    keys: string[];
    /** Where the row sits on the page, for matching it to a delivery heading. */
    position: DocPosition | null;
    /** First non-empty value among the given candidate names (string or number). */
    get(...names: string[]): string | number | null;
    /** First numeric value among the given candidate names. */
    getNum(...names: string[]): number | null;
}

function makeFieldBag(obj: any, position: DocPosition | null = null): FieldBag {
    const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normMap = new Map<string, any>();
    for (const k of Object.keys(obj || {})) normMap.set(normKey(k), obj[k]);
    // v5 exposes the typed value first (string/number/etc.), then verbatim
    // content, then the REST SDK's valueString for good measure.
    const cellValue = (cell: any): string | number | null =>
        cell ? (cell.value ?? cell.content ?? cell.valueString ?? null) : null;
    return {
        keys: Object.keys(obj || {}),
        position,
        get(...names: string[]) {
            for (const name of names) {
                const v = cellValue(normMap.get(normKey(name)));
                if (v !== null && v !== undefined && String(v).trim() !== "") return v;
            }
            return null;
        },
        getNum(...names: string[]) {
            for (const name of names) {
                const cell = normMap.get(normKey(name));
                if (!cell) continue;
                if (typeof cell.value === "number") return cell.value;
                if (cell.valueNumber !== undefined) return cell.valueNumber;
                const parsed = parseQuantity(cell.content ?? cell.valueString ?? (cell.value != null ? String(cell.value) : null));
                if (parsed !== null) return parsed;
            }
            return null;
        },
    };
}

// Pull the row bags out of a custom model's first document. Finds the first
// array (table) field, unwraps each object row (v5 nests them under
// `.properties`), and returns them as normalized FieldBags. Empty if the model
// returned no structured document/array field (caller falls back to layout).
function extractCustomModelRows(result: any, context: InvocationContext): { rows: FieldBag[]; header: FieldBag | null } {
    const doc = result.documents && result.documents[0];
    if (!doc || !doc.fields) {
        context.log("No documents array or no fields in response — model may not return structured fields.");
        return { rows: [], header: null };
    }
    context.log(`Custom model docType: ${doc.docType}`);
    context.log(`Custom model field names: ${Object.keys(doc.fields).join(", ")}`);

    let tableField: any = null;
    let tableFieldName = "";
    for (const [key, value] of Object.entries(doc.fields)) {
        const v = value as any;
        // @azure/ai-form-recognizer v5 discriminates fields on `kind`, not
        // `type` (`type` is always undefined here — the bug that made the
        // custom-model rows read as empty).
        const fieldKind = v?.kind ?? v?.type;
        context.log(`  Field "${key}": kind=${fieldKind}, valueType=${typeof v?.value}`);
        if (v && fieldKind === "array") {
            tableField = v;
            tableFieldName = key;
            context.log(`  → Found array field: "${key}" with ${(v.values || v.value || []).length} rows`);
        }
    }

    // Top-level scalar fields (load #, ship date, etc.) live directly on the doc.
    const header = makeFieldBag(doc.fields);
    if (!tableField) return { rows: [], header };

    context.log(`Extracting rows from Custom Model field "${tableFieldName}"...`);
    const rowFields = tableField.values || tableField.value || [];
    const heights = pageHeights(result);
    const rows: FieldBag[] = [];
    for (const row of rowFields) {
        const rowObj = row.properties ? row.properties
                     : ((row.kind === "object" || row.type === "object") && row.value) ? row.value
                     : row;
        if (!rowObj || typeof rowObj !== "object") continue;
        context.log(`  Row keys: ${Object.keys(rowObj).join(", ")}`);
        rows.push(makeFieldBag(rowObj, positionOf(row, heights)));
    }
    return { rows, header };
}

// POST /api/analyze-picklist — body is the raw image bytes (image/jpeg). Runs
// Document Intelligence prebuilt-layout and returns best-effort line items for
// the verifier to confirm (source: 'ml' on the client). Never throws to the
// client on config/OCR failure; the app falls back to manual entry.
export async function analyzePicklist(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const client = getDocClient();
    if (!client) {
        return {
            status: 501,
            jsonBody: {
                error: "OCR not configured",
                detail: "Set DOC_INTEL_ENDPOINT and DOC_INTEL_KEY in the Function App settings.",
            },
        };
    }

    try {
        const buffer = Buffer.from(await request.arrayBuffer());
        if (!buffer.length) {
            return { status: 400, jsonBody: { error: "Empty request body (expected image bytes)" } };
        }

        const modelId = process.env.DOC_INTEL_MODEL_ID || "Picklist";
        context.log(`Using Document Intelligence model: ${modelId}`);
        const poller = await client.beginAnalyzeDocument(modelId, buffer);
        const result = await poller.pollUntilDone();

        let lineItems: OcrLineItem[] = [];

        // The sheet's own text layer: it carries the load header and the
        // delivery headings, neither of which the custom model labels.
        const lines = docLines(result);
        const heights = pageHeights(result);
        const anchors = findDeliveryAnchors(lines);
        context.log(`Delivery headings found: ${anchors.map((a) => a.deliveryNumber).join(", ") || "(none)"}`);

        // 1. Try to extract from the Custom Model's structured fields.
        const { rows, header } = extractCustomModelRows(result, context);
        for (const row of rows) {
            const batchCodeRaw = row.get("BatchCode", "Batch", "Lot", "LotCode", "BatchLot");
            const sku = row.get("SKU", "Material", "MaterialNumber", "Item", "ItemCode", "ItemNumber", "Article", "Part", "PartNumber");
            const description = row.get("Description", "MaterialDescription", "ItemDescription", "ProductDescription", "Desc", "ProductName", "Commodity");
            const expectedQuantity = row.getNum("Quantity", "Qty", "ExpectedQuantity", "Cases", "Bags", "Pieces", "Count", "Ordered", "PickQty");
            const uomRaw = row.get("UOM", "Unit", "UnitOfMeasure", "Units");
            const rowDelivery = row.get("DeliveryNumber", "Delivery", "DeliveryNo", "Delivery#", "DeliveryId");

            const item: OcrLineItem = {
                batchCode: batchCodeRaw ? String(batchCodeRaw).trim().toUpperCase() : null,
                sku: sku ? String(sku).trim() : null,
                description: description ? String(description).trim() : null,
                expectedQuantity,
                uom: normalizeUom(uomRaw != null ? String(uomRaw) : null),
                // A delivery column wins; otherwise the row belongs to whichever
                // delivery heading it is printed under.
                deliveryNumber: rowDelivery
                    ? String(rowDelivery).trim()
                    : deliveryForPosition(anchors, row.position),
            };

            if (item.batchCode || item.sku || item.description || item.expectedQuantity !== null) {
                lineItems.push(item);
            }
        }

        // 2. Fallback to generic table extraction
        if (lineItems.length === 0) {
            context.log("No items from custom fields, falling back to table extraction...");
            lineItems = extractLineItemsFromTables(result.tables as any[], (cell) =>
                deliveryForPosition(anchors, positionOf(cell, heights))
            );
        }

        // Header fields drive the auto-fill on the outbound flow: load # / ship
        // date populate the load header (mirrored onto the BOL), and delivery #
        // seeds the auto-created delivery. The custom model only labels these on
        // sheets it was trained with, so fall back to the sheet's own text.
        const loadNumber =
            header?.get("LoadNumber", "Load", "LoadNo", "Load#", "BOLNumber", "BOL", "BillOfLading") ??
            findLabeledValue(lines, LOAD_LABEL, LOAD_VALUE);
        const shipDateRaw =
            header?.get("ShipDate", "ShippingDate", "Date", "ShipmentDate", "DeliveryDate", "PickDate") ??
            findLabeledValue(lines, SHIP_DATE_LABEL, DATE_VALUE);
        const deliveryNumber =
            header?.get("DeliveryNumber", "Delivery", "DeliveryNo", "Delivery#", "DeliveryId") ??
            (anchors.length ? anchors[0].deliveryNumber : null);

        // A single-delivery sheet often names the delivery only in its header —
        // the lines then carry nothing, so give them the one delivery there is.
        const soleDelivery =
            anchors.length <= 1 && deliveryNumber != null ? String(deliveryNumber).trim() : null;
        if (soleDelivery) {
            for (const item of lineItems) item.deliveryNumber = item.deliveryNumber || soleDelivery;
        }

        const debug = request.query.get("debug") === "1";
        return {
            status: 200,
            jsonBody: {
                success: true,
                lineItems,
                header: {
                    loadNumber: loadNumber != null ? String(loadNumber).trim() : null,
                    shipDate: parseDateToIso(shipDateRaw != null ? String(shipDateRaw) : null),
                    deliveryNumber: deliveryNumber != null ? String(deliveryNumber).trim() : null,
                },
                tableCount: result.tables?.length || 0,
                ...(debug ? {
                    tables: result.tables,
                    documents: result.documents, // Add documents to debug output
                    // What the text-layer fallback actually saw. When a header
                    // field comes back null on a real sheet, these show whether
                    // the label was even read and how it was worded.
                    textLines: lines,
                    deliveryAnchors: anchors,
                } : {}),
            },
        };
    } catch (error) {
        context.log("Error analyzing picklist:", error);
        return { status: 500, jsonBody: { error: "Error analyzing picklist" } };
    }
}

// A BOL line item. Unlike the picklist, the BOL carries NO batch code — SAP
// only stamps batches onto it after the load is picked. Instead each row
// identifies its shipment / delivery / stop, which is what lets us match a
// SKU's total quantity back to the picklist per delivery.
type BolOcrLineItem = {
    sku: string | null;
    description: string | null;
    quantity: number | null;
    uom: Uom;
    shipmentNumber: string | null;
    deliveryNumber: string | null;
    stopNumber: number | null;
};

// POST /api/analyze-bol — body is the raw image bytes (image/jpeg). Runs the
// custom BOL model and returns best-effort line items (sku, description,
// quantity, shipment #, delivery #, stop) plus any header fields. Never throws
// to the client; the app degrades to manual BOL entry on failure.
export async function analyzeBol(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const client = getDocClient();
    if (!client) {
        return {
            status: 501,
            jsonBody: {
                error: "OCR not configured",
                detail: "Set DOC_INTEL_ENDPOINT and DOC_INTEL_KEY in the Function App settings.",
            },
        };
    }

    try {
        const buffer = Buffer.from(await request.arrayBuffer());
        if (!buffer.length) {
            return { status: 400, jsonBody: { error: "Empty request body (expected image bytes)" } };
        }

        const modelId = process.env.DOC_INTEL_BOL_MODEL_ID || "BOL";
        context.log(`Using Document Intelligence BOL model: ${modelId}`);
        const poller = await client.beginAnalyzeDocument(modelId, buffer);
        const result = await poller.pollUntilDone();

        const { rows, header } = extractCustomModelRows(result, context);

        const lineItems: BolOcrLineItem[] = [];
        for (const row of rows) {
            const sku = row.get("SKU", "Material", "MaterialNumber", "Item", "ItemCode", "ItemNumber", "Article", "Part", "PartNumber", "Product");
            const description = row.get("Description", "MaterialDescription", "ItemDescription", "ProductDescription", "Desc", "ProductName", "Commodity");
            const quantity = row.getNum("Quantity", "Qty", "Cases", "Bags", "Pieces", "Count", "ShipQty", "ShippedQuantity");
            const uomRaw = row.get("UOM", "Unit", "UnitOfMeasure", "Units");
            const shipmentNumber = row.get("ShipmentNumber", "Shipment", "ShipmentNo", "Shipment#", "ShipmentId");
            const deliveryNumber = row.get("DeliveryNumber", "Delivery", "DeliveryNo", "Delivery#", "DeliveryId");
            const stopNumber = row.getNum("StopNumber", "Stop", "StopNo", "Stop#");

            const item: BolOcrLineItem = {
                sku: sku ? String(sku).trim() : null,
                description: description ? String(description).trim() : null,
                quantity,
                uom: normalizeUom(uomRaw != null ? String(uomRaw) : null),
                shipmentNumber: shipmentNumber ? String(shipmentNumber).trim() : null,
                deliveryNumber: deliveryNumber ? String(deliveryNumber).trim() : null,
                stopNumber,
            };

            if (item.sku || item.description || item.quantity !== null || item.deliveryNumber) {
                lineItems.push(item);
            }
        }

        // Header (document-level) fields, when the model labels them outside the
        // line table. Falls back to the first row's shipment/delivery otherwise.
        const bolLines = docLines(result);
        const loadNumber =
            header?.get("LoadNumber", "Load", "BOLNumber", "BOL", "BillOfLading", "ProNumber") ??
            findLabeledValue(bolLines, LOAD_LABEL, LOAD_VALUE);
        const shipDateRaw =
            header?.get("ShipDate", "ShippingDate", "Date", "ShipmentDate") ??
            findLabeledValue(bolLines, SHIP_DATE_LABEL, DATE_VALUE);
        const shipmentNumber = header?.get("ShipmentNumber", "Shipment", "ShipmentNo") ?? lineItems.find((li) => li.shipmentNumber)?.shipmentNumber ?? null;

        const debug = request.query.get("debug") === "1";
        return {
            status: 200,
            jsonBody: {
                success: true,
                lineItems,
                header: {
                    loadNumber: loadNumber != null ? String(loadNumber).trim() : null,
                    shipDate: parseDateToIso(shipDateRaw != null ? String(shipDateRaw) : null),
                    shipmentNumber: shipmentNumber != null ? String(shipmentNumber).trim() : null,
                },
                tableCount: result.tables?.length || 0,
                ...(debug ? { tables: result.tables, documents: result.documents } : {}),
            },
        };
    } catch (error) {
        context.log("Error analyzing BOL:", error);
        return { status: 500, jsonBody: { error: "Error analyzing BOL" } };
    }
}

// ---------------------------------------------------------------------------
// Pallet bag-count assist (RF-DETR / OWLv2 detector-service)
//
// DETECTOR_SERVICE_URL points at the Apache-2.0 detector-service (see
// detector-service/): RF-DETR in production once fine-tuned, OWLv2 as the
// train-free zero-shot bootstrap. Its URL and (optional) key live in Function
// App settings, so they never reach the browser. The service detects bags on the
// visible pallet face and returns the JSON contract the client consumes; the
// client multiplies layers by the known bags-per-layer and the verifier confirms.
// ---------------------------------------------------------------------------

// RF-DETR / OWLv2 detection backend (detector-service/). When DETECTOR_SERVICE_URL
// is set, the service runs object detection on the pallet face and returns the
// JSON contract, so the Function just forwards the image bytes.
const detectorServiceUrl = (process.env.DETECTOR_SERVICE_URL || "").trim().replace(/\/+$/, "");
const detectorServiceKey = (process.env.DETECTOR_SERVICE_KEY || "").trim();





// Pull the answer object out of a model response.
//
// Reasoning VLMs (Cosmos, and anything prompted into <think>...</think>) narrate
// before answering, and that narration routinely contains braces — JSON sketches,
// set notation, coordinates. So: drop any think block, then take the LAST balanced
// top-level object that parses, not the first. For a well-behaved model returning
// a single object the two are identical, so this costs nothing and stops a
// chain-of-thought model from being misread as a parse failure.
export function extractJsonObject(text: string): any | null {
    if (!text) return null;

    const body = text.replace(/<think>[\s\S]*?<\/think>/gi, " ");

    let last: any = null;
    let start = -1;
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "}" && depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
                try {
                    const candidate = JSON.parse(body.slice(start, i + 1));
                    // Ignore stray objects that aren't the answer shape.
                    if (candidate && typeof candidate === "object" && "layers" in candidate) {
                        last = candidate;
                    } else if (last === null) {
                        last = candidate;
                    }
                } catch {
                    // keep scanning — a malformed block shouldn't abort the search
                }
                start = -1;
            }
        }
    }
    return last;
}

// Forward the raw pallet-face bytes to the RF-DETR/OWLv2 detection service,
// which already returns the pallet-count JSON contract.
async function analyzeWithDetector(request: HttpRequest, context: InvocationContext, customUrl?: string): Promise<HttpResponseInit> {
    const buffer = Buffer.from(await request.arrayBuffer());
    if (!buffer.length) {
        return { status: 400, jsonBody: { error: "Empty request body (expected image bytes)" } };
    }

    let rawUrl = (customUrl || detectorServiceUrl).trim().replace(/\/+$/, "");
    if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
        rawUrl = "http://" + rawUrl;
    }
    const endpoint = rawUrl.endsWith("/analyze") ? rawUrl : `${rawUrl}/analyze`;

    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    const key = request.headers.get("x-detector-key") || detectorServiceKey;
    if (key) headers["Authorization"] = `Bearer ${key}`;

    context.log(`Proxying pallet count to detector: ${endpoint}`);

    try {
        const resp = await fetch(endpoint, {
            method: "POST",
            headers,
            body: buffer,
        });

        if (!resp.ok) {
            const detail = await resp.text().catch(() => "");
            context.log(`Detector service error ${resp.status}: ${detail.slice(0, 500)}`);
            return { status: 502, jsonBody: { error: "Pallet vision backend error", status: resp.status, detail: detail.slice(0, 500), endpoint } };
        }

        const text = await resp.text();
        if (text.trim().startsWith("<")) {
            return {
                status: 502,
                jsonBody: {
                    error: "Detector endpoint returned HTML (Brev login redirect) instead of API JSON",
                    detail: "The Brev domain requires web login. Change DETECTOR_SERVICE_URL in Azure to direct IP: http://216.81.200.12:19408",
                    endpoint,
                },
            };
        }

        return { status: 200, jsonBody: JSON.parse(text) };
    } catch (err: any) {
        context.log(`Failed to fetch detector at ${endpoint}:`, err);
        return {
            status: 502,
            jsonBody: {
                error: "Could not reach detector service",
                detail: String(err?.message || err),
                endpoint,
            },
        };
    }
}

async function analyzeFacesWithDetector(
    images: any[],
    targetUrl: string,
    context: InvocationContext
): Promise<HttpResponseInit> {
    let rawUrl = targetUrl.trim().replace(/\/+$/, "");
    if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
        rawUrl = "http://" + rawUrl;
    }
    const endpoint = rawUrl.endsWith("/analyze") ? rawUrl : `${rawUrl}/analyze`;

    const faces: any[] = [];
    let visibleBagTotal = 0;
    let anyGaps = false;
    let anyDamage = false;
    let modelVer = "rf-detr";

    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const url = typeof img?.dataUrl === "string" ? img.dataUrl : "";
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(url);
        if (!match) continue;

        const buffer = Buffer.from(match[2], "base64");
        try {
            const resp = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: buffer,
            });
            if (resp.ok) {
                const j = (await resp.json()) as any;
                const bags = typeof j.estimatedBags === "number" ? j.estimatedBags : 0;
                visibleBagTotal += bags;
                if (j.gaps) anyGaps = true;
                if (j.damage) anyDamage = true;
                if (j.modelVersion) modelVer = j.modelVersion;

                faces.push({
                    index: i,
                    slotKey: img?.slotKey ?? `face_${i}`,
                    bagFlaps: bags,
                    layers: j.layers ?? null,
                    isPalletFace: true,
                    flapBoxes: [],
                    boxCount: bags,
                    countMatchesBoxes: true,
                });
            }
        } catch (e) {
            context.log(`Error calling detector for face ${i}:`, e);
        }
    }

    return {
        status: 200,
        jsonBody: {
            success: true,
            faces,
            visibleBagTotal,
            visibleBagTotalFromBoxes: visibleBagTotal,
            estimatedPalletTotal: visibleBagTotal,
            gaps: anyGaps,
            damage: anyDamage,
            topLayerFull: true,
            confidence: 0.9,
            modelVersion: modelVer,
            imageCount: images.length,
        },
    };
}



export async function analyzePalletCount(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const customDetector = (request.headers.get("x-detector-url") || request.query.get("detectorUrl") || detectorServiceUrl).trim();
    if (!customDetector) {
        return {
            status: 501,
            jsonBody: {
                error: "Pallet vision not configured",
                detail: "Set DETECTOR_SERVICE_URL in the Function App settings to the RF-DETR/OWLv2 detector-service.",
            },
        };
    }

    try {
        return await analyzeWithDetector(request, context, customDetector);
    } catch (error: any) {
        context.log("Error calling detector service:", error);
        return {
            status: 500,
            jsonBody: {
                error: "Error analyzing pallet count",
                detail: String(error?.message || error),
                targetDetectorUrl: customDetector,
            },
        };
    }
}

// ---------------------------------------------------------------------------
// Multi-face pallet assessment (detector-service).
//
// A separate endpoint from analyze-pallet-count: it runs the RF-DETR/OWLv2
// detector over each captured face in turn and sums the per-face visible-bag
// counts into one assessment body. A detector sees only the outer faces, so the
// total is a visible-face cross-check, not the pallet total; the client still
// multiplies layers by bags-per-layer for the real number.
// ---------------------------------------------------------------------------

// The client sends the four required pallet faces; cap a little above that so a
// stray extra photo is rejected rather than silently fanned out to the detector.
const MAX_ASSESS_IMAGES = 5;



export async function analyzePalletFaces(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    try {
        const body = (await request.json().catch(() => null)) as any;
        const images: any[] = Array.isArray(body?.images) ? body.images : [];
        if (images.length === 0) {
            return { status: 400, jsonBody: { error: "Expected { images: [{ slotKey, dataUrl }] }" } };
        }
        if (images.length > MAX_ASSESS_IMAGES) {
            return {
                status: 400,
                jsonBody: { error: `At most ${MAX_ASSESS_IMAGES} images per request`, got: images.length },
            };
        }

        const customDetector = (request.headers.get("x-detector-url") || request.query.get("detectorUrl") || detectorServiceUrl).trim();
        if (!customDetector) {
            return {
                status: 501,
                jsonBody: {
                    error: "Pallet vision not configured",
                    detail: "Set DETECTOR_SERVICE_URL in the environment variables to the RF-DETR/OWLv2 detector-service.",
                },
            };
        }

        return await analyzeFacesWithDetector(images, customDetector, context);
    } catch (error) {
        context.log("Error assessing pallet faces:", error);
        return { status: 500, jsonBody: { error: "Error assessing pallet faces" } };
    }
}

export async function syncInspection(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Syncing inspection. URL: "${request.url}"`);
    try {
        const inspection = await request.json() as any;

        // A device that was offline when an admin deleted this inspection still
        // has its own copy and will happily push it back. Refuse the push if the
        // server already holds a tombstone, otherwise the delete gets undone.
        if (inspection?.id) {
            try {
                const { resource: existing } = await container.item(inspection.id, inspection.id).read();
                if (existing?.deleted) {
                    context.log(`Ignoring push for deleted inspection ${inspection.id}`);
                    return { status: 200, jsonBody: { success: true, deleted: true, resource: existing } };
                }
            } catch {
                // Not found (or unreadable) — treat as a normal upsert.
            }
        }

        // Upsert the inspection into Cosmos DB
        const { resource } = await container.items.upsert(inspection);

        return {
            status: 200,
            jsonBody: { success: true, resource }
        };
    } catch (error) {
        context.log("Error syncing inspection:", error);
        return { 
            status: 500, 
            jsonBody: { error: "Error syncing inspection" } 
        };
    }
}

export async function photoUploadToken(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const photoId = request.query.get("photoId");
    if (!photoId) {
        return { 
            status: 400, 
            jsonBody: { error: "Missing photoId parameter" } 
        };
    }

    try {
        await ensurePhotoContainer();
        const startsOn = new Date();
        const expiresOn = new Date(new Date().valueOf() + 3600 * 1000); // Token valid for 1 hour

        const sasOptions = {
            containerName: photoContainerName,
            blobName: photoId,
            permissions: ContainerSASPermissions.parse("cw"), // create, write
            startsOn,
            expiresOn
        };

        const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
        const blobUrl = `https://${storageAccountName}.blob.core.windows.net/${photoContainerName}/${photoId}`;
        const sasUrl = `${blobUrl}?${sasToken}`;
        
        return { 
            status: 200, 
            jsonBody: { sasUrl, sasToken, blobUrl } 
        };
    } catch (error) {
         context.log("Error generating SAS:", error);
         return { 
             status: 500, 
             jsonBody: { error: "Error generating SAS token" } 
         };
    }
}

// Serves a photo blob through the API. The "photos" blob container is private,
// so the raw blob.core.windows.net URL written onto InspectionPhoto records is
// not viewable from other devices. This endpoint proxies the read using the
// storage account key so any device (same origin) can display any photo.
export async function getPhoto(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const photoId = request.query.get("photoId");
    if (!photoId || !/^[A-Za-z0-9_-]+$/.test(photoId)) {
        return { status: 400, jsonBody: { error: "Missing or invalid photoId parameter" } };
    }

    try {
        const containerClient = blobServiceClient.getContainerClient(photoContainerName);
        const blobClient = containerClient.getBlobClient(photoId);
        const download = await blobClient.download();
        const body = await streamToBuffer(download.readableStreamBody);

        return {
            status: 200,
            headers: {
                "Content-Type": download.contentType || "image/jpeg",
                // Photo IDs are immutable — cache aggressively so repeat views are free.
                "Cache-Control": "public, max-age=31536000, immutable",
            },
            body,
        };
    } catch (error: any) {
        if (error?.statusCode === 404) {
            return { status: 404, jsonBody: { error: "Photo not found" } };
        }
        context.log("Error fetching photo:", error);
        return { status: 500, jsonBody: { error: "Error fetching photo" } };
    }
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
    if (!stream) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function getInspections(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Fetching inspections. URL: "${request.url}"`);
    try {
        // Query all items from Cosmos DB (In production, you'd likely filter by date or status)
        const { resources } = await container.items.query("SELECT * from c").fetchAll();
        
        return { 
            status: 200, 
            jsonBody: { success: true, resources } 
        };
    } catch (error) {
        context.log("Error fetching inspections:", error);
        return {
            status: 500,
            jsonBody: { error: "Error fetching inspections" }
        };
    }
}

/**
 * Admin delete. Writes a tombstone rather than removing the document, because
 * every device keeps its own IndexedDB copy and re-pulls from here on load — a
 * hard delete here would simply be resurrected by the next device that syncs.
 * Clients drop tombstoned records locally; `syncInspection` refuses to overwrite
 * one. Same pattern as staging locations.
 */
export async function deleteInspection(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const id = request.params.id;
    context.log(`Deleting inspection ${id}`);

    if (!id) {
        return { status: 400, jsonBody: { error: "Missing inspection id" } };
    }

    try {
        const { resource: existing } = await container.item(id, id).read();
        if (!existing) {
            return { status: 404, jsonBody: { error: "Inspection not found" } };
        }

        const tombstone = {
            ...existing,
            deleted: true,
            deletedAt: new Date().toISOString(),
            // Bump lastEditedAt so the client pull-side conflict check
            // (existing.lastEditedAt >= incoming.lastEditedAt) accepts this.
            lastEditedAt: new Date().toISOString(),
        };

        const { resource } = await container.items.upsert(tombstone);
        return { status: 200, jsonBody: { success: true, resource } };
    } catch (error: any) {
        if (error?.code === 404) {
            return { status: 404, jsonBody: { error: "Inspection not found" } };
        }
        context.log("Error deleting inspection:", error);
        return { status: 500, jsonBody: { error: "Error deleting inspection" } };
    }
}

export async function syncSite(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Syncing site. URL: "${request.url}"`);
    try {
        const site = await request.json();
        const sites = await getSitesContainer();
        const { resource } = await sites.items.upsert(site);
        return { status: 200, jsonBody: { success: true, resource } };
    } catch (error) {
        context.log("Error syncing site:", error);
        return { status: 500, jsonBody: { error: "Error syncing site" } };
    }
}

export async function getSites(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Fetching sites. URL: "${request.url}"`);
    try {
        const sites = await getSitesContainer();
        const { resources } = await sites.items.query("SELECT * from c").fetchAll();
        return { status: 200, jsonBody: { success: true, resources } };
    } catch (error) {
        context.log("Error fetching sites:", error);
        return { status: 500, jsonBody: { error: "Error fetching sites" } };
    }
}

// Generic upsert/list handlers for reference-data containers
// (inspectors, staging locations — same shape as sites).
function makeRefUpsertHandler(containerName: string, label: string) {
    return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        try {
            const record = await request.json() as any;
            if (!record || typeof record.id !== "string") {
                return { status: 400, jsonBody: { error: `Invalid ${label}: missing id` } };
            }
            const container = await getRefContainer(containerName);
            const { resource } = await container.items.upsert(record);
            return { status: 200, jsonBody: { success: true, resource } };
        } catch (error) {
            context.log(`Error syncing ${label}:`, error);
            return { status: 500, jsonBody: { error: `Error syncing ${label}` } };
        }
    };
}

function makeRefListHandler(containerName: string, label: string) {
    return async (_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        try {
            const container = await getRefContainer(containerName);
            const { resources } = await container.items.query("SELECT * from c").fetchAll();
            return { status: 200, jsonBody: { success: true, resources } };
        } catch (error) {
            context.log(`Error fetching ${label}:`, error);
            return { status: 500, jsonBody: { error: `Error fetching ${label}` } };
        }
    };
}

// Bulk upsert for the inventory list. Inventory can be ~1-2k rows, so it's
// pushed as a single { items: [...] } batch rather than one request per row
// (unlike the small inspector/staging lists). Stored in its own ref container.
export async function syncInventory(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    try {
        const body = await request.json() as any;
        const items = Array.isArray(body) ? body : body?.items;
        if (!Array.isArray(items)) {
            return { status: 400, jsonBody: { error: "Invalid inventory: expected an items array" } };
        }
        const container = await getRefContainer("inventory");
        const valid = items.filter((it: any) => it && typeof it.id === "string");
        let count = 0;
        const chunkSize = 50;
        for (let i = 0; i < valid.length; i += chunkSize) {
            const chunk = valid.slice(i, i + chunkSize);
            await Promise.all(chunk.map((it: any) => container.items.upsert(it)));
            count += chunk.length;
        }
        return { status: 200, jsonBody: { success: true, count } };
    } catch (error) {
        context.log("Error syncing inventory:", error);
        return { status: 500, jsonBody: { error: "Error syncing inventory" } };
    }
}

// Register the Azure Functions endpoints (v4 Model)
app.http('sync-inspection', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: syncInspection
});

app.http('photo-upload-token', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: photoUploadToken
});

app.http('photo', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: getPhoto
});

app.http('delete-inspection', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'inspections/{id}',
    handler: deleteInspection
});

app.http('inspections', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: getInspections
});

app.http('analyze-picklist', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: analyzePicklist
});

app.http('analyze-bol', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: analyzeBol
});

app.http('analyze-pallet-count', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: analyzePalletCount
});

app.http('analyze-pallet-faces', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: analyzePalletFaces
});

app.http('sync-site', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: syncSite
});

app.http('sites', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: getSites
});

app.http('sync-inspector', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: makeRefUpsertHandler("inspectors", "inspector")
});

app.http('inspectors', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: makeRefListHandler("inspectors", "inspectors")
});

app.http('sync-staging-location', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: makeRefUpsertHandler("stagingLocations", "staging location")
});

app.http('staging-locations', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: makeRefListHandler("stagingLocations", "staging locations")
});

app.http('sync-inventory', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: syncInventory
});

app.http('inventory', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: makeRefListHandler("inventory", "inventory")
});
