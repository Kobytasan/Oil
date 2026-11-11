require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

let initPromise = null;

function init() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Змінна середовища DATABASE_URL не задана. Вставте рядок підключення з Neon (Project → Connection Details → Connection string).'
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📦'
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      category_id INT REFERENCES categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      unit TEXT DEFAULT 'шт',
      price_retail NUMERIC(10,2) NOT NULL,
      price_wholesale NUMERIC(10,2) NOT NULL,
      wholesale_min INT DEFAULT 10,
      stock INT DEFAULT 0,
      featured BOOLEAN DEFAULT FALSE,
      icon TEXT DEFAULT '📦'
    );
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      position TEXT NOT NULL,
      login TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker'
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      company TEXT,
      city TEXT,
      address TEXT,
      delivery TEXT,
      payment TEXT,
      comment TEXT,
      total NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'нове',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      qty INT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      wholesale BOOLEAN DEFAULT FALSE
    );
  `);

  await seedEmployees();
  await seedProducts();
}

async function seedEmployees() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM employees');
  if (rows[0].n > 0) return;

  const users = [
    ['Мельник Олег Степанович', 'Директор', 'director', 'Director2026!', 'director'],
    ['Ковальчук Ірина Василівна', 'Менеджер з продажів', 'manager', 'Manager2026!', 'manager'],
    ['Ткачук Богдан Іванович', 'Комірник', 'sklad', 'Sklad2026!', 'worker'],
    ['Шевченко Оксана Петрівна', 'Касир', 'kasa', 'Kasa2026!', 'worker'],
  ];
  for (const [name, position, login, pass, role] of users) {
    await pool.query(
      'INSERT INTO employees (name, position, login, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
      [name, position, login, bcrypt.hashSync(pass, 10), role]
    );
  }
  console.log('✔ Створено облікові записи працівників (директор: director / Director2026!)');
}

async function seedProducts() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (rows[0].n > 0) return;

  const catalog = [
    {
      name: 'Крупи та макарони',
      icon: '🌾',
      items: [
        ['Крупа гречана «Столична», 1 кг', 'Ядро гречки вищого ґатунку, фасовка 1 кг. Оптові партії в мішках по 25 кг.', 'шт', 42, 34, 10, 320, true, '🌾'],
        ['Макарони «Барвінок» спагеті, 500 г', 'Спагеті з твердих сортів пшениці, група А.', 'шт', 28, 22, 10, 410, false, '🍝'],
        ['Рис «Екстра» довгозерний, 900 г', 'Шліфований довгозерний рис, 1-й ґатунок.', 'шт', 45, 38, 10, 260, false, '🍚'],
      ],
    },
    {
      name: 'Олія та соуси',
      icon: '🫒',
      items: [
        ['Олія соняшникова «Сонце», нерафінована, 850 мл', 'Соняшникова олія першого віджиму, виготовлена з українського насіння.', 'шт', 55, 46, 10, 380, true, '🌻'],
        ['Олія оливкова «Mediterranea», 500 мл', 'Оливкова олія extra virgin, перший холодний віджим.', 'шт', 180, 165, 10, 120, false, '🫒'],
        ['Кетчуп «Помідорка» класичний, 470 г', 'Томатний соус з м’яким смаком, скляна тара.', 'шт', 39, 32, 10, 240, false, '🍅'],
      ],
    },
    {
      name: 'Консерви',
      icon: '🥫',
      items: [
        ['Тушонка яловича «Лісова», 325 г', 'Натуральна яловича тушонка, м’ясо 90%.', 'шт', 95, 85, 10, 150, false, '🥫'],
        ['Кукурудза консервована «Золотий сезон», 340 г', 'Солодка кукурудза у зернах, вища категорія.', 'шт', 32, 27, 10, 300, false, '🌽'],
        ['Оселедець атлантичний «Дунай», 240 г', 'Філе оселедця в олії.', 'шт', 58, 49, 10, 180, false, '🐟'],
      ],
    },
    {
      name: 'Напої',
      icon: '🧃',
      items: [
        ['Сік яблучний «Гроно» прямого віджиму, 1 л', 'Нектар у скляній пляшці, без консервантів.', 'шт', 38, 33, 10, 290, true, '🧃'],
        ['Вода мінеральна «Трясун», 2 л', 'Природна мінеральна слабкозагазована вода.', 'шт', 22, 18, 10, 560, false, '💧'],
        ['Кава мелена «Арабіка Золотий дукат», 250 г', 'Мелена кава 100% арабіка, середнє обсмаження.', 'шт', 120, 105, 10, 140, false, '☕'],
      ],
    },
    {
      name: 'Солодощі',
      icon: '🍫',
      items: [
        ['Шоколад «Світоч» молочний, 90 г', 'Молочний шоколад без добавок.', 'шт', 35, 30, 10, 350, true, '🍫'],
        ['Печиво «Смак» вівсяне, 350 г', 'Вівсяне печиво з родзинками.', 'шт', 41, 35, 10, 270, false, '🍪'],
      ],
    },
    {
      name: 'Побутова хімія',
      icon: '🧴',
      items: [
        ['Засіб для миття посуду «Глянець», 500 мл', 'Концентрований гель для миття посуду, алое вера.', 'шт', 48, 40, 10, 330, false, '🧴'],
        ['Порошок пральний «Квітневий», 2 кг', 'Автомат, підходить для всіх типів тканин.', 'шт', 165, 150, 10, 190, false, '🧺'],
        ['Мило туалетне «Ромашкове», 90 г', 'Тверде туалетне мило з екстрактом ромашки.', 'шт', 14, 11, 10, 700, false, '🧼'],
      ],
    },
  ];

  for (const cat of catalog) {
    const { rows } = await pool.query(
      'INSERT INTO categories (name, icon) VALUES ($1,$2) RETURNING id',
      [cat.name, cat.icon]
    );
    const catId = rows[0].id;
    for (const [name, description, unit, pr, pw, wmin, stock, featured, icon] of cat.items) {
      await pool.query(
        `INSERT INTO products
         (category_id, name, description, unit, price_retail, price_wholesale, wholesale_min, stock, featured, icon)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [catId, name, description, unit, pr, pw, wmin, stock, featured, icon]
      );
    }
  }
  console.log('✔ Наповнено каталог тестовими товарами');
}

module.exports = { pool, init, query: (t, p) => pool.query(t, p) };
