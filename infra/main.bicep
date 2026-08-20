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

@description('Origins allowed to call the API. Set to the static site URL after the first deployment.')
param allowedOrigin string = '*'

@description('Signs the sign-in tokens. Pass a long random value.')
@secure()
param authSecret string

@description('SKU for Azure AI Language. F0 is free and is enough for sentiment.')
@allowed(['F0', 'S0'])
param cognitiveSku string = 'F0'

@description('SKU for Azure AI Speech. Batch transcription rejects F0 with "Only Standard subscriptions are valid", so this has to be S0.')
@allowed(['F0', 'S0'])
param speechSku string = 'S0'

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower('${appName}${suffix}')
var cosmosName = toLower('${appName}-cosmos-${suffix}')
var speechName = '${appName}-speech-${suffix}'
var languageName = '${appName}-lang-${suffix}'
var planName = '${appName}-plan'
var funcName = '${appName}-api-${suffix}'
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
  sku: { name: speechSku }
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

// ---------------- Consumption plan + Function App (the REST API) ----------------
// Consumption billing means the API scales out per request and costs nothing
// while nobody is watching, which is the whole point of the serverless shape.
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'functionapp'
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }      // reserved = Linux
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: funcName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      cors: {
        allowedOrigins: [ allowedOrigin ]
        supportCredentials: false
      }
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        // A consumption plan keeps the function content on a file share, and it
        // will not start without these two. Leaving them out gives a host that
        // lists its functions but answers every call with a 503.
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'WEBSITE_CONTENTSHARE', value: toLower(funcName) }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_KEY', value: cosmos.listKeys().primaryMasterKey }
        { name: 'COSMOS_DATABASE', value: dbName }
        { name: 'STORAGE_ACCOUNT', value: storage.name }
        { name: 'STORAGE_KEY', value: storage.listKeys().keys[0].value }
        { name: 'VIDEO_CONTAINER', value: videoContainer }
        { name: 'SPEECH_KEY', value: speech.listKeys().key1 }
        { name: 'SPEECH_REGION', value: location }
        { name: 'LANGUAGE_ENDPOINT', value: language.properties.endpoint }
        { name: 'LANGUAGE_KEY', value: language.listKeys().key1 }
        { name: 'AUTH_SECRET', value: authSecret }
        { name: 'LIST_CACHE_SECONDS', value: '20' }
      ]
    }
  }
}

output apiName string = api.name
output apiUrl string = 'https://${api.properties.defaultHostName}'
output storageAccount string = storage.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output staticSiteHint string = 'Enable static website on ${storage.name}, then read primaryEndpoints.web'
