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

type OcrLineItem = {
    batchCode: string | null;
    productName: string | null;
    expectedQuantity: number | null;
    uom: "BAG" | "SP" | "PCE";
};

// Header keyword → semantic column. First match wins, checked in order.
const COLUMN_KEYWORDS: Array<{ key: keyof OcrLineItem; words: string[] }> = [
    { key: "batchCode", words: ["batch", "lot"] },
    { key: "expectedQuantity", words: ["qty", "quantity", "cases", "bags", "count", "pieces", "ordered", "pick"] },
    { key: "uom", words: ["uom", "unit"] },
    { key: "productName", words: ["product", "description", "item", "material", "sku", "commodity"] },
];

function normalizeUom(raw: string | null): "BAG" | "SP" | "PCE" {
    const v = (raw || "").toUpperCase();
    if (v.includes("SP")) return "SP";
    if (v.includes("PCE") || v.includes("PC") || v.includes("EA") || v.includes("PIECE")) return "PCE";
    return "BAG";
}

function parseQuantity(raw: string | null): number | null {
    if (!raw) return null;
    const m = raw.replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
}

// Map a prebuilt-layout table into line items by matching header cells to the
// keyword table above. Layout preserves cell row/column indices, so we detect
// the header row (row 0), build a column→field map, then read each data row.
function extractLineItemsFromTables(tables: any[] | undefined): OcrLineItem[] {
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
        const hasIdentifier = mappedFields.has("batchCode") || mappedFields.has("productName");
        if (!mappedFields.has("expectedQuantity") || !hasIdentifier) continue;

        const maxRow = Math.max(...cells.map((c) => c.rowIndex));
        for (let r = 1; r <= maxRow; r++) {
            const rowCells = cells.filter((c) => c.rowIndex === r);
            if (!rowCells.length) continue;

            const raw: Record<string, string | null> = {};
            for (const cell of rowCells) {
                const field = colToField.get(cell.columnIndex);
                if (field) raw[field] = String(cell.content || "").trim() || null;
            }

            const item: OcrLineItem = {
                batchCode: raw.batchCode ? raw.batchCode.toUpperCase() : null,
                productName: raw.productName ?? null,
                expectedQuantity: parseQuantity(raw.expectedQuantity ?? null),
                uom: normalizeUom(raw.uom ?? null),
            };
            // Skip empty/subtotal rows.
            if (item.batchCode || item.productName || item.expectedQuantity !== null) {
                items.push(item);
            }
        }
    }

    return items;
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

        const poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer);
        const result = await poller.pollUntilDone();
        const lineItems = extractLineItemsFromTables(result.tables as any[]);

        const debug = request.query.get("debug") === "1";
        return {
            status: 200,
            jsonBody: {
                success: true,
                lineItems,
                tableCount: result.tables?.length || 0,
                ...(debug ? { tables: result.tables } : {}),
            },
        };
    } catch (error) {
        context.log("Error analyzing picklist:", error);
        return { status: 500, jsonBody: { error: "Error analyzing picklist" } };
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
