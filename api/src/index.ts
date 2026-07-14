import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient, generateBlobSASQueryParameters, ContainerSASPermissions, StorageSharedKeyCredential } from "@azure/storage-blob";

// Initialize Cosmos DB Client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING || "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==");
const database = cosmosClient.database("loadout-db");
const container = database.container("inspections");

// Initialize Blob Storage Client
const storageAccountName = process.env.STORAGE_ACCOUNT_NAME || "devstoreaccount1";
const storageAccountKey = process.env.STORAGE_ACCOUNT_KEY || "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const sharedKeyCredential = new StorageSharedKeyCredential(storageAccountName, storageAccountKey);
// Note: In production, the blob endpoint might differ depending on region/suffix. This is standard Azure Blob URL.
const blobServiceClient = new BlobServiceClient(`https://${storageAccountName}.blob.core.windows.net`, sharedKeyCredential);
const photoContainerName = "photos";

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
