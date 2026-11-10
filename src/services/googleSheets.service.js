async function proxyGoogleSheets(method, search = '', body = undefined) {
  const webAppUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL?.trim();

  if (!webAppUrl) {
    return {
      statusCode: 500,
      payload: { ok: false, error: 'GOOGLE_SHEETS_WEBAPP_URL no configurada' },
    };
  }

  try {
    const upstream = await fetch(`${webAppUrl}${search}`, {
      signal: AbortSignal.timeout(15000),
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await upstream.text();
    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    return {
      statusCode: upstream.ok ? 200 : 502,
      payload: {
        ...data,
        ok: upstream.ok && data.ok === true,
        upstreamStatus: upstream.status,
      },
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: { ok: false, error: 'No se pudo contactar con Google Sheets' },
    };
  }
}

module.exports = {
  proxyGoogleSheets,
};
