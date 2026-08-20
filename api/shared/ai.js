// Cognitive services used as the project's advanced features:
//   1) Azure AI Language  -> sentiment of every comment
//   2) Azure AI Speech    -> batch transcription of each uploaded video
// Uses the global fetch built into Node 18+ (no extra SDK needed).

// ---------- Sentiment (Azure AI Language) ----------
async function sentiment(text) {
  const endpoint = process.env.LANGUAGE_ENDPOINT;
  const key = process.env.LANGUAGE_KEY;
  if (!endpoint || !key || !text) return null;      // feature is optional; degrade gracefully
  const url = endpoint.replace(/\/$/, "") + "/language/:analyze-text?api-version=2023-04-01";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": key },
    body: JSON.stringify({
      kind: "SentimentAnalysis",
      analysisInput: { documents: [{ id: "1", language: "en", text: text.slice(0, 5000) }] }
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.results && data.results.documents && data.results.documents[0];
  if (!doc) return null;
  return { label: doc.sentiment, scores: doc.confidenceScores };   // positive|neutral|negative
}

// ---------- Speech-to-text batch transcription ----------
function speechBase() {
  const region = process.env.SPEECH_REGION;
  return `https://${region}.api.cognitive.microsoft.com/speechtotext/v3.1`;
}
function speechHeaders() {
  return {
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": process.env.SPEECH_KEY
  };
}

// submit a transcription job for a blob URL (SAS). Returns the job "self" URL.
async function speechSubmit(contentUrl, displayName, locale = "en-GB") {
  if (!process.env.SPEECH_KEY || !process.env.SPEECH_REGION) return null;
  const res = await fetch(speechBase() + "/transcriptions", {
    method: "POST",
    headers: speechHeaders(),
    body: JSON.stringify({
      contentUrls: [contentUrl],
      locale,
      displayName: displayName || "video-transcription",
      properties: { wordLevelTimestampsEnabled: false, punctuationMode: "DictatedAndAutomatic" }
    })
  });
  if (!res.ok) {
    console.error("Speech rejected the transcription job", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.self || null;
}

// poll a job; when Succeeded, download and return the combined transcript text.
async function speechResult(jobUrl) {
  if (!jobUrl) return { status: "None" };
  const res = await fetch(jobUrl, { headers: speechHeaders() });
  if (!res.ok) return { status: "Failed" };
  const job = await res.json();
  if (job.status !== "Succeeded") return { status: job.status };   // NotStarted|Running|Failed
  // fetch the result file list
  const filesRes = await fetch(job.links.files, { headers: speechHeaders() });
  const files = await filesRes.json();
  const t = (files.values || []).find(f => f.kind === "Transcription");
  if (!t) return { status: "Succeeded", text: "" };
  const contentRes = await fetch(t.links.contentUrl);           // SAS-signed, no key needed
  const content = await contentRes.json();
  const text = (content.combinedRecognizedPhrases || []).map(p => p.display).join(" ");
  return { status: "Succeeded", text };
}

module.exports = { sentiment, speechSubmit, speechResult };
