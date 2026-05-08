(function () {
  const ACCESS_FILE = "./Dashboard/Data/client-access-codes.json";
  const PERFORMANCE_FILE = "./Dashboard/Data/performance-dashboard.json";
  const FALLBACK_MONTH = "2026-03";

  function normalizeAccessCode(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 5);
  }

  function formatMonthKey(year, month) {
    return String(year) + "-" + String(month).padStart(2, "0");
  }

  function getLatestMonth(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return null;
    }

    return rows
      .filter(function (row) {
        return Number.isFinite(Number(row.year)) && Number.isFinite(Number(row.month));
      })
      .sort(function (a, b) {
        return (a.year - b.year) || (a.month - b.month);
      })
      .map(function (row) {
        return formatMonthKey(row.year, row.month);
      })
      .pop() || null;
  }

  function hasMeaningfulData(row) {
    if (!row || typeof row !== "object") {
      return false;
    }

    return [
      row.total_views,
      row.ig_views,
      row.fb_views,
      row.tiktok_views,
      row.ig_followers,
      row.fb_followers,
      row.tiktok_followers,
      row.ttl_followers,
      row.website_traffic,
      row.ad_spend,
      row.new_leads,
      row.ttl_leads,
      row.total_booking_revenue,
      row.direct_booking_revenue
    ].some(function (value) {
      return Number(value) > 0;
    });
  }

  async function loadLoginData() {
    const responses = await Promise.all([
      fetch(ACCESS_FILE),
      fetch(PERFORMANCE_FILE)
    ]);

    if (!responses[0].ok) {
      throw new Error("The access code file could not be loaded.");
    }

    if (!responses[1].ok) {
      throw new Error("The dashboard data file could not be loaded.");
    }

    const payloads = await Promise.all(responses.map(function (response) {
      return response.json();
    }));

    return {
      accessData: payloads[0],
      performanceData: payloads[1]
    };
  }

  function resolveClientAccess(code, accessData) {
    const normalizedCode = normalizeAccessCode(code);
    return (accessData.clients || []).find(function (client) {
      return client.accessCode === normalizedCode;
    }) || null;
  }

  function buildClientToken(clientSlug, accessCode) {
    const normalizedCode = normalizeAccessCode(accessCode);
    return normalizedCode ? String(clientSlug || "") + normalizedCode : String(clientSlug || "");
  }

  function getLatestClientMonth(performanceData, clientSlug) {
    const rowsByClientSlug = performanceData.rowsByClientSlug || {};
    const rows = rowsByClientSlug[clientSlug] || [];
    const meaningfulRows = rows.filter(hasMeaningfulData);
    return getLatestMonth(meaningfulRows.length ? meaningfulRows : rows) || FALLBACK_MONTH;
  }

  function buildDashboardUrl(clientSlug, month, view, metadata) {
    const details = metadata || {};
    const target = new URL("./Dashboard/", window.location.href);
    target.searchParams.set("client", buildClientToken(clientSlug, details.accessCode));
    target.searchParams.set("month", month || FALLBACK_MONTH);
    target.searchParams.set("view", view || "roi");
    return target.toString();
  }

  async function openClientDashboard(code, options) {
    const settings = options || {};
    const normalizedCode = normalizeAccessCode(code);

    if (normalizedCode.length !== 5) {
      throw new Error("Please enter a valid 5-digit access code.");
    }

    const loaded = settings.loadedData || await loadLoginData();
    const matchedClient = resolveClientAccess(normalizedCode, loaded.accessData);

    if (!matchedClient) {
      throw new Error("That code was not recognized. Please try again.");
    }

    const latestMonth = getLatestClientMonth(loaded.performanceData, matchedClient.clientSlug);
    const targetUrl = buildDashboardUrl(matchedClient.clientSlug, latestMonth, settings.view || "roi", {
      accessCode: normalizedCode,
      clientName: matchedClient.clientName
    });

    if (settings.redirect === false) {
      return {
        client: matchedClient,
        month: latestMonth,
        url: targetUrl
      };
    }

    window.location.assign(targetUrl);
    return {
      client: matchedClient,
      month: latestMonth,
      url: targetUrl
    };
  }

  window.HiddenGemLogin = {
    ACCESS_FILE: ACCESS_FILE,
    PERFORMANCE_FILE: PERFORMANCE_FILE,
    FALLBACK_MONTH: FALLBACK_MONTH,
    normalizeAccessCode: normalizeAccessCode,
    loadLoginData: loadLoginData,
    resolveClientAccess: resolveClientAccess,
    getLatestClientMonth: getLatestClientMonth,
    buildClientToken: buildClientToken,
    buildDashboardUrl: buildDashboardUrl,
    openClientDashboard: openClientDashboard
  };
}());
