# Vantij

A video sharing web application built for COM769 coursework 2, running on Azure.

Creators publish short clips and set the details that go with them. Anyone can
sign in to browse the newest uploads, search the catalogue, watch a clip,
comment on it and give it a rating.

## What it does

**Creator accounts** upload video and set the title, publisher, producer, genre
and age rating on every clip. There is no public sign-up page for creators; the
role is held in the database and granted by an administrator.

**Consumer accounts** are open to anyone with a Microsoft account. A consumer
can browse, search, play, comment and rate, but cannot upload.

**The dashboard** shows the latest clips, with search across titles, publishers,
producers and the spoken transcript.

## How it is put together

The front end is static HTML, CSS and JavaScript, served straight from Azure
Blob Storage static website hosting. No server renders a page. It talks to the
backend over REST.

The backend is a set of Azure Functions on a consumption plan, so the API scales
out per request and costs nothing while nobody is watching.

Data is split between two stores: Azure Cosmos DB for accounts, clips, comments
and ratings, and Azure Blob Storage for the video files themselves.

Accounts live in Cosmos DB. Passwords are stored as scrypt hashes, signing in
returns a signed token, and the role is read from the database and checked on the
server for every write.

Uploads go straight from the browser to Blob Storage using a short-lived signed
URL, so video never travels through the API.

Each uploaded clip is transcribed by Azure AI Speech, and every comment is
scored by Azure AI Language.

The dashboard response is cached for a few seconds, both in the function and at
the edge, and it is dropped as soon as a new clip is published.

## Running it locally

The Azure Functions Core Tools run the API, and any static server will do for
the front end.

```
cd api && npm install && npm start
```

The API comes up on http://localhost:7071. Serve `frontend` with anything
static and set `apiBaseUrl` in `frontend/config.json` to that address.

Copy `api/local.settings.json.example` to `api/local.settings.json` and fill in
the connection details first.

Run the tests:

```
cd api
npm test
```

## Layout

```
frontend/   the static site, plus config.json which points it at the API
api/        the Functions that make up the REST API
  shared/   database, storage, auth, cache and AI helpers
  test/     the test suite
infra/      the Azure resources, as Bicep
seed/       demo creators and clips
```

## Settings

Everything is read from application settings, listed in
`api/local.settings.json.example`. The same code runs locally and on Azure.
