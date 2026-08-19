// Blob Storage for the video files. Clients upload straight to Blob using a
// short-lived SAS URL (write-only, ~30 min) so large uploads never pass through
// the Functions API - that is what keeps the API from becoming a bottleneck.
const {
  BlobServiceClient, StorageSharedKeyCredential,
  generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol
} = require("@azure/storage-blob");

const account = process.env.STORAGE_ACCOUNT;
const key = process.env.STORAGE_KEY;
const containerName = process.env.VIDEO_CONTAINER || "videos";

function cred() {
  if (!account || !key) throw new Error("STORAGE_ACCOUNT / STORAGE_KEY not configured.");
  return new StorageSharedKeyCredential(account, key);
}
function serviceClient() {
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, cred());
}

async function ensureContainer() {
  const c = serviceClient().getContainerClient(containerName);
  // public read on blobs so the <video> tag can stream directly; metadata/roles
  // still guard who can create/list through the API.
  await c.createIfNotExists({ access: "blob" });
  return c;
}

// write-only SAS for the client to PUT the file
async function uploadSas(blobName, minutes = 30) {
  await ensureContainer();
  const now = new Date();
  const expiry = new Date(now.getTime() + minutes * 60000);
  const sas = generateBlobSASQueryParameters({
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse("cw"),   // create + write
    startsOn: new Date(now.getTime() - 5 * 60000),
    expiresOn: expiry,
    protocol: SASProtocol.Https
  }, cred()).toString();
  const url = `https://${account}.blob.core.windows.net/${containerName}/${blobName}?${sas}`;
  const publicUrl = `https://${account}.blob.core.windows.net/${containerName}/${blobName}`;
  return { uploadUrl: url, publicUrl };
}

// read SAS (used to hand the blob to Azure Speech for transcription)
async function readSas(blobName, minutes = 60) {
  const now = new Date();
  const sas = generateBlobSASQueryParameters({
    containerName, blobName,
    permissions: BlobSASPermissions.parse("r"),
    startsOn: new Date(now.getTime() - 5 * 60000),
    expiresOn: new Date(now.getTime() + minutes * 60000),
    protocol: SASProtocol.Https
  }, cred()).toString();
  return `https://${account}.blob.core.windows.net/${containerName}/${blobName}?${sas}`;
}

function publicUrl(blobName) {
  return `https://${account}.blob.core.windows.net/${containerName}/${blobName}`;
}

module.exports = { uploadSas, readSas, publicUrl, ensureContainer };
