import {
  getProductMetafields,
  updateVariantPrice,
  calculatePrice,
} from '../../lib/shopify';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const password = req.headers['x-admin-password'];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { productId, variants, goldRate, gstPercent } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  try {
    const productMetas = await getProductMetafields(productId);

    const goldWeight    = parseFloat(productMetas.gold_weight_grams)      || 0;
    const diamondValue  = parseFloat(productMetas.diamond_value)           || 0;
    const makingFixed   = parseFloat(productMetas.making_charge_fixed)     || 0;
    const stonePrice    = parseFloat(productMetas.stone_price)             || 0;

    if (!goldWeight) {
      return res.status(200).json({
        status: 'skipped',
        reason: 'No gold weight specified'
      });
    }

    const result = calculatePrice({
      goldWeight,
      goldRate,
      diamondValue,
      makingFixed,
      stonePrice,
      gstPercent,
    });

    for (const variant of (variants || [])) {
      await updateVariantPrice(variant.id, result.finalPrice);
    }

    return res.status(200).json({
      status: 'updated',
      price: result.finalPrice
    });

  } catch (err) {
    return res.status(500).json({
      status: 'error',
      reason: err.message
    });
  }
}
