require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'olis-shop-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

/* ---------- Загальне middleware ---------- */
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  res.locals.cartCount = (req.session.cart || []).reduce((s, i) => s + i.qty, 0);
  try {
    await db.init();
    res.locals.dbError = null;
  } catch (e) {
    res.locals.dbError = e.message;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Доступ заборонено',
        user: req.session.user,
        dbError: null,
        message: 'У вас немає прав для цієї дії. Зверніться до директора.',
      });
    }
    next();
  };
}

/* ---------- Кошик ---------- */
async function cartData(req) {
  const cart = req.session.cart || [];
  if (!cart.length) return { items: [], total: 0, count: 0 };
  const ids = cart.map((i) => i.id);
  const { rows } = await db.query('SELECT * FROM products WHERE id = ANY($1)', [ids]);
  const items = cart
    .map((i) => {
      const p = rows.find((r) => r.id === i.id);
      if (!p) return null;
      const wholesale = i.qty >= p.wholesale_min;
      const price = Number(wholesale ? p.price_wholesale : p.price_retail);
      return { product: p, qty: i.qty, price, sum: price * i.qty, wholesale };
    })
    .filter(Boolean);
  return {
    items,
    total: items.reduce((s, i) => s + i.sum, 0),
    count: items.reduce((s, i) => s + i.qty, 0),
  };
}

/* ---------- Публічні сторінки ---------- */
app.get('/', async (req, res, next) => {
  try {
    const cats = await db.query('SELECT * FROM categories ORDER BY id');
    const featured = await db.query(
      `SELECT p.*, c.name AS category_name, c.icon AS cat_icon
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.featured = TRUE ORDER BY p.id LIMIT 4`
    );
    res.render('home', { title: 'Головна', categories: cats.rows, featured: featured.rows });
  } catch (e) {
    next(e);
  }
});

app.get('/catalog', async (req, res, next) => {
  try {
    const cats = await db.query('SELECT * FROM categories ORDER BY id');
    const where = [];
    const params = [];
    if (req.query.cat) {
      params.push(Number(req.query.cat));
      where.push(`p.category_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push('%' + req.query.q + '%');
      where.push(`p.name ILIKE $${params.length}`);
    }
    const sql = `
      SELECT p.*, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.id`;
    const prods = await db.query(sql, params);
    res.render('catalog', {
      title: 'Каталог продукції',
      categories: cats.rows,
      products: prods.rows,
      currentCat: req.query.cat ? Number(req.query.cat) : null,
      q: req.query.q || '',
    });
  } catch (e) {
    next(e);
  }
});

app.get('/product/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).render('error', {
        title: 'Товар не знайдено',
        user: req.session.user || null,
        dbError: null,
        message: 'Такого товару немає в каталозі.',
      });
    }
    res.render('product', { title: rows[0].name, product: rows[0] });
  } catch (e) {
    next(e);
  }
});

app.post('/cart/add/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const qty = Math.max(1, Number(req.body.qty) || 1);
    const { rows } = await db.query('SELECT id FROM products WHERE id = $1', [id]);
    if (!rows.length) return res.redirect('/catalog');
    const cart = req.session.cart || [];
    const existing = cart.find((i) => i.id === id);
    if (existing) existing.qty += qty;
    else cart.push({ id, qty });
    req.session.cart = cart;
    res.redirect(req.body.back || '/cart');
  } catch (e) {
    next(e);
  }
});

app.post('/cart/update', (req, res) => {
  const id = Number(req.body.id);
  const qty = Number(req.body.qty);
  const cart = req.session.cart || [];
  const item = cart.find((i) => i.id === id);
  if (item) {
    if (qty > 0) item.qty = qty;
    else req.session.cart = cart.filter((i) => i.id !== id);
  }
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const id = Number(req.body.id);
  req.session.cart = (req.session.cart || []).filter((i) => i.id !== id);
  res.redirect('/cart');
});

app.get('/cart', async (req, res, next) => {
  try {
    const data = await cartData(req);
    res.render('cart', { title: 'Кошик', ...data });
  } catch (e) {
    next(e);
  }
});

app.get('/checkout', async (req, res, next) => {
  try {
    const data = await cartData(req);
    if (!data.items.length) return res.redirect('/cart');
    res.render('checkout', { title: 'Оформлення замовлення', ...data });
  } catch (e) {
    next(e);
  }
});

app.post('/checkout', async (req, res, next) => {
  try {
    const data = await cartData(req);
    if (!data.items.length) return res.redirect('/cart');
    const { customer_name, phone, company, city, address, delivery, payment, comment } = req.body;
    if (!customer_name || !phone) {
      return res.render('checkout', {
        title: 'Оформлення замовлення',
        ...data,
        error: 'Вкажіть, будь ласка, ПІБ та телефон.',
        form: req.body,
      });
    }
    const { rows } = await db.query(
      `INSERT INTO orders (customer_name, phone, company, city, address, delivery, payment, comment, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [customer_name, phone, company || null, city || null, address || null, delivery || null, payment || null, comment || null, data.total]
    );
    const orderId = rows[0].id;
    for (const it of data.items) {
      await db.query(
        'INSERT INTO order_items (order_id, product_name, qty, price, wholesale) VALUES ($1,$2,$3,$4,$5)',
        [orderId, it.product.name, it.qty, it.price, it.wholesale]
      );
      await db.query('UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id = $2', [it.qty, it.product.id]);
    }
    req.session.cart = [];
    res.redirect('/order/' + orderId + '?new=1');
  } catch (e) {
    next(e);
  }
});

app.get('/order/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      return res.status(404).render('error', {
        title: 'Замовлення не знайдено',
        user: req.session.user || null,
        dbError: null,
        message: 'Такого замовлення не існує.',
      });
    }
    const items = await db.query('SELECT * FROM order_items WHERE order_id = $1', [rows[0].id]);
    res.render('order', {
      title: 'Замовлення №' + rows[0].id,
      order: rows[0],
      items: items.rows,
      isNew: req.query.new === '1',
    });
  } catch (e) {
    next(e);
  }
});

/* ---------- Вхід для працівників ---------- */
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('login', { title: 'Вхід для працівників', error: null });
});

app.post('/login', async (req, res, next) => {
  try {
    const { login, password } = req.body;
    const bcrypt = require('bcryptjs');
    const { rows } = await db.query('SELECT * FROM employees WHERE login = $1', [login || '']);
    const emp = rows[0];
    if (!emp || !bcrypt.compareSync(password || '', emp.password_hash)) {
      return res.status(401).render('login', {
        title: 'Вхід для працівників',
        error: 'Невірний логін або пароль. Спробуйте ще раз.',
      });
    }
    req.session.user = { id: emp.id, name: emp.name, position: emp.position, role: emp.role };
    res.redirect('/admin');
  } catch (e) {
    next(e);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

/* ---------- Панель керування ---------- */
app.get('/admin', requireAuth, async (req, res, next) => {
  try {
    const [products, orders, employees, newOrders, revenue] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM products'),
      db.query('SELECT COUNT(*)::int AS n FROM orders'),
      db.query('SELECT COUNT(*)::int AS n FROM employees'),
      db.query("SELECT COUNT(*)::int AS n FROM orders WHERE status = 'нове'"),
      db.query('SELECT COALESCE(SUM(total),0)::numeric AS s FROM orders WHERE status <> $1', ['скасовано']),
    ]);
    const latest = await db.query('SELECT * FROM orders ORDER BY id DESC LIMIT 5');
    res.render('admin/dashboard', {
      title: 'Панель керування',
      counts: {
        products: products.rows[0].n,
        orders: orders.rows[0].n,
        employees: employees.rows[0].n,
        newOrders: newOrders.rows[0].n,
        revenue: Number(revenue.rows[0].s),
      },
      latest: latest.rows,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/admin/products', requireRole('director', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id`
    );
    const cats = await db.query('SELECT * FROM categories ORDER BY id');
    res.render('admin/products', { title: 'Товари', products: rows, categories: cats.rows });
  } catch (e) {
    next(e);
  }
});

app.get('/admin/products/new', requireRole('director', 'manager'), async (req, res, next) => {
  try {
    const cats = await db.query('SELECT * FROM categories ORDER BY id');
    res.render('admin/product_form', { title: 'Новий товар', product: null, categories: cats.rows });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/products', requireRole('director', 'manager'), async (req, res, next) => {
  try {
    const b = req.body;
    await db.query(
      `INSERT INTO products (category_id, name, description, unit, price_retail, price_wholesale, wholesale_min, stock, featured, icon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [b.category_id || null, b.name, b.description || '', b.unit || 'шт', Number(b.price_retail) || 0,
       Number(b.price_wholesale) || 0, Number(b.wholesale_min) || 10, Number(b.stock) || 0,
       b.featured === 'on', b.icon || '📦']
    );
    res.redirect('/admin/products');
  } catch (e) {
    next(e);
  }
});

app.get('/admin/products/:id/edit', requireRole('director', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.redirect('/admin/products');
    const cats = await db.query('SELECT * FROM categories ORDER BY id');
    res.render('admin/product_form', { title: 'Редагування товару', product: rows[0], categories: cats.rows });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/products/:id', requireRole('director', 'manager'), async (req, res, next) => {
  try {
    const b = req.body;
    await db.query(
      `UPDATE products SET category_id=$1, name=$2, description=$3, unit=$4, price_retail=$5,
       price_wholesale=$6, wholesale_min=$7, stock=$8, featured=$9, icon=$10 WHERE id=$11`,
      [b.category_id || null, b.name, b.description || '', b.unit || 'шт', Number(b.price_retail) || 0,
       Number(b.price_wholesale) || 0, Number(b.wholesale_min) || 10, Number(b.stock) || 0,
       b.featured === 'on', b.icon || '📦', req.params.id]
    );
    res.redirect('/admin/products');
  } catch (e) {
    next(e);
  }
});

app.post('/admin/products/:id/delete', requireRole('director', 'manager'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.redirect('/admin/products');
  } catch (e) {
    next(e);
  }
});

app.get('/admin/orders', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders ORDER BY id DESC');
    res.render('admin/orders', { title: 'Замовлення', orders: rows });
  } catch (e) {
    next(e);
  }
});

app.get('/admin/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.redirect('/admin/orders');
    const items = await db.query('SELECT * FROM order_items WHERE order_id = $1', [rows[0].id]);
    res.render('admin/order_details', { title: 'Замовлення №' + rows[0].id, order: rows[0], items: items.rows });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/orders/:id/status', requireRole('director', 'manager', 'worker'), async (req, res, next) => {
  try {
    const allowed = ['нове', 'підтверджено', 'відправлено', 'виконано', 'скасовано'];
    if (allowed.includes(req.body.status)) {
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
    }
    res.redirect(req.body.back || '/admin/orders');
  } catch (e) {
    next(e);
  }
});

app.get('/admin/employees', requireRole('director'), async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM employees ORDER BY id');
    res.render('admin/employees', { title: 'Працівники', employees: rows, msg: req.query.msg || null });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/employees', requireRole('director'), async (req, res, next) => {
  try {
    const { name, position, login, password, role } = req.body;
    if (!name || !login || !password) {
      return res.redirect('/admin/employees?msg=' + encodeURIComponent('Заповніть усі поля!'));
    }
    const bcrypt = require('bcryptjs');
    try {
      await db.query(
        'INSERT INTO employees (name, position, login, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
        [name, position || 'Працівник', login, bcrypt.hashSync(password, 10), role || 'worker']
      );
    } catch (e) {
      return res.redirect('/admin/employees?msg=' + encodeURIComponent('Логін уже зайнятий або дані некоректні.'));
    }
    res.redirect('/admin/employees');
  } catch (e) {
    next(e);
  }
});

app.post('/admin/employees/:id/delete', requireRole('director'), async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      return res.redirect('/admin/employees?msg=' + encodeURIComponent('Неможливо видалити власний обліковий запис.'));
    }
    await db.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    res.redirect('/admin/employees');
  } catch (e) {
    next(e);
  }
});

/* ---------- Обробка помилок ---------- */
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Сторінку не знайдено',
    user: req.session.user || null,
    dbError: null,
    message: 'Такої сторінки не існує.',
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Помилка сервера',
    user: req.session.user || null,
    dbError: null,
    message: 'Сталася внутрішня помилка сервера. Спробуйте пізніше.',
  });
});

app.listen(PORT, () => {
  console.log(`🛒 Сайт «Оліс» запущено: http://localhost:${PORT}`);
});
