import { getAllProducts } from '../../lib/shopify';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const password = req.headers['x-admin-password'];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const products = await getAllProducts();
    res.status(200).json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
