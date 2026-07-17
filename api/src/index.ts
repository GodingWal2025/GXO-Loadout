import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient, generateBlobSASQueryParameters, ContainerSASPermissions, StorageSharedKeyCredential } from "@azure/storage-blob";

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

export async function syncInspection(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Syncing inspection. URL: "${request.url}"`);
    try {
        const inspection = await request.json();
        
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

app.http('inspections', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: getInspections
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
