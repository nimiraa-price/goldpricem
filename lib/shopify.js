const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN  = process.env.SHOPIFY_ADMIN_TOKEN;

const BASE_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01`;

const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': SHOPIFY_TOKEN,
};

// Robust fetch helper to automatically handle rate limits (429) and network errors
async function safeFetch(url, options = {}, retries = 5, backoff = 1000) {
  for (let i = 0; i < retries; i++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (networkError) {
      // Network failures (DNS, connection drop) - safe to retry
      if (i === retries - 1) throw networkError;
      console.warn(`[Shopify Network Error] Retrying in ${backoff}ms...`, networkError.message);
      await new Promise(r => setTimeout(r, backoff));
      backoff *= 2;
      continue;
    }

    // Handle rate limits (Shopify leaky bucket full)
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const waitTime = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : backoff;
      console.warn(`[Shopify Rate Limit 429] Waiting ${waitTime}ms before retry (attempt ${i + 1}/${retries})...`);
      await new Promise(r => setTimeout(r, waitTime));
      backoff *= 2;
      continue;
    }

    if (!res.ok) {
      const bodyText = await res.text();
      // Do NOT retry on 4xx/5xx HTTP errors (except 429) as they are permanent failures
      throw new Error(`Shopify API error [${res.status}]: ${bodyText || res.statusText}`);
    }

    return res;
  }
}

// ─── Metafields ───────────────────────────────────────────────────────────────

export async function getShopMetafields() {
  const res  = await safeFetch(`${BASE_URL}/metafields.json?namespace=custom`, { headers });
  const data = await res.json();
  const map  = {};
  (data.metafields || []).forEach(m => { map[m.key] = { id: m.id, value: m.value }; });
  return map;
}

export async function setShopMetafield(key, value, type = 'number_decimal') {
  // Try update first, then create
  const existing = await getShopMetafieldByKey(key);
  if (existing) {
    await safeFetch(`${BASE_URL}/metafields/${existing.id}.json`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ metafield: { id: existing.id, value: String(value), type } }),
    });
  } else {
    await safeFetch(`${BASE_URL}/metafields.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ metafield: { namespace: 'custom', key, value: String(value), type } }),
    });
  }
}

async function getShopMetafieldByKey(key) {
  const res  = await safeFetch(`${BASE_URL}/metafields.json?namespace=custom&key=${key}`, { headers });
  const data = await res.json();
  return data.metafields?.[0] || null;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export async function getAllProducts() {
  let products = [];
  let url      = `${BASE_URL}/products.json?limit=250&fields=id,title,variants`;

  while (url) {
    const res  = await safeFetch(url, { headers });
    const data = await res.json();
    products   = products.concat(data.products || []);

    const link = res.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url        = next ? next[1] : null;
  }
  return products;
}

export async function getProductMetafields(productId) {
  const res  = await safeFetch(`${BASE_URL}/products/${productId}/metafields.json?namespace=custom`, { headers });
  const data = await res.json();
  const map  = {};
  (data.metafields || []).forEach(m => { map[m.key] = m.value; });
  return map;
}

export async function getVariantMetafields(variantId) {
  const res  = await safeFetch(`${BASE_URL}/variants/${variantId}/metafields.json?namespace=custom`, { headers });
  const data = await res.json();
  const map  = {};
  (data.metafields || []).forEach(m => { map[m.key] = m.value; });
  return map;
}

export async function updateVariantPrice(variantId, price) {
  await safeFetch(`${BASE_URL}/variants/${variantId}.json`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ variant: { id: variantId, price: price.toFixed(2) } }),
  });
}

// ─── Purity helpers ───────────────────────────────────────────────────────────

export const PURITY_KEYS = ['9k', '14k', '18k', '22k', '24k'];

export const PURITY_LABEL_MAP = {
  '9K':  'gold_rate_9k',
  '14K': 'gold_rate_14k',
  '18K': 'gold_rate_18k',
  '22K': 'gold_rate_22k',
  '24K': 'gold_rate_24k',
};

// ─── Price formula ────────────────────────────────────────────────────────────

export function calculatePrice({ goldWeight, goldRate, diamondValue, makingFixed, stonePrice, gstPercent }) {
  const tgp         = goldWeight * goldRate;
  const makingCharge = makingFixed * goldWeight;
  const tgpm        = tgp + makingCharge;
  const stoneVal    = stonePrice || 0;
  const output      = tgpm + diamondValue + stoneVal;
  const finalPrice  = output + (output * gstPercent / 100);
  return {
    goldCost:    Math.round(tgp),
    makingCharge: Math.round(makingCharge),
    diamondValue: Math.round(diamondValue),
    stonePrice:  Math.round(stoneVal),
    output:      Math.round(output),
    gstAmount:   Math.round(output * gstPercent / 100),
    finalPrice:  Math.round(finalPrice),
  };
}
