// Small helpers so every function returns consistent JSON responses.
function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

const ok       = (ctx, body) => json(ctx, 200, body);
const created  = (ctx, body) => json(ctx, 201, body);
const badReq   = (ctx, msg)  => json(ctx, 400, { error: msg });
const unauth   = (ctx)       => json(ctx, 401, { error: "Sign in required." });
const forbid   = (ctx, msg)  => json(ctx, 403, { error: msg || "Not allowed for your role." });
const notFound = (ctx, msg)  => json(ctx, 404, { error: msg || "Not found." });
const serverErr = (ctx, e)   => { ctx.log.error(e); json(ctx, 500, { error: "Server error." }); };

module.exports = { json, ok, created, badReq, unauth, forbid, notFound, serverErr };
