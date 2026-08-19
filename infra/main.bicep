// ============================================================================
//  Vantij - Infrastructure as Code (Bicep)
//  Provisions every Azure resource the app needs, wired together with app
//  settings so the Functions API can reach Cosmos, Blob, Speech and Language.
//
//  Deploy:  az group create -n vantij-rg -l uksouth
//           az deployment group create -g vantij-rg \
//               -f infra/main.bicep -p @infra/main.parameters.json
// ============================================================================
@description('Base name; resource names derive from this.')
param appName string = 'vantij'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('SKU for the Cognitive Services (F0 = free where available, else S0).')
@allowed(['F0', 'S0'])
param cognitiveSku string = 'S0'

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower('${appName}${suffix}')
var cosmosName = toLower('${appName}-cosmos-${suffix}')
var speechName = '${appName}-speech-${suffix}'
var languageName = '${appName}-lang-${suffix}'
var swaName = '${appName}-web-${suffix}'
var dbName = 'vantij'
var videoContainer = 'videos'

// ---------------- Storage (video files) ----------------
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: true
    minimumTlsVersion: 'TLS1_2'
  }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
}
resource videos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: videoContainer
  properties: { publicAccess: 'Blob' }
}

// ---------------- Cosmos DB (NoSQL, free tier) ----------------
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [ { locationName: location, failoverPriority: 0 } ]
  }
}
resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: dbName
  properties: {
    resource: { id: dbName }
    options: { throughput: 1000 }   // shared throughput, covered by the free tier
  }
}
var containers = [
  { name: 'videos',   pk: '/id' }
  { name: 'comments', pk: '/videoId' }
  { name: 'ratings',  pk: '/videoId' }
  { name: 'users',    pk: '/id' }
]
resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in containers: {
  parent: cosmosDb
  name: c.name
  properties: {
    resource: {
      id: c.name
      partitionKey: { paths: [ c.pk ], kind: 'Hash' }
    }
  }
}]

// ---------------- Azure AI Speech (transcription) ----------------
resource speech 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: speechName
  location: location
  kind: 'SpeechServices'
  sku: { name: cognitiveSku }
  properties: { customSubDomainName: speechName }
}

// ---------------- Azure AI Language (sentiment) ----------------
resource language 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: languageName
  location: location
  kind: 'TextAnalytics'
  sku: { name: cognitiveSku }
  properties: { customSubDomainName: languageName }
}

// ---------------- Static Web App (frontend + managed Functions API) ----------------
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: location
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    // repo is connected after deployment (see DEPLOYMENT_GUIDE) so CI/CD can run
    buildProperties: {
      appLocation: 'CW2_Solution/frontend'
      apiLocation: 'CW2_Solution/api'
    }
  }
}

// wire the API to the backing services via app settings
resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
    COSMOS_KEY: cosmos.listKeys().primaryMasterKey
    COSMOS_DATABASE: dbName
    STORAGE_ACCOUNT: storage.name
    STORAGE_KEY: storage.listKeys().keys[0].value
    VIDEO_CONTAINER: videoContainer
    SPEECH_KEY: speech.listKeys().key1
    SPEECH_REGION: location
    LANGUAGE_ENDPOINT: language.properties.endpoint
    LANGUAGE_KEY: language.listKeys().key1
  }
}

output staticWebAppName string = swa.name
output staticWebAppUrl string = 'https://${swa.properties.defaultHostname}'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output storageAccount string = storage.name
