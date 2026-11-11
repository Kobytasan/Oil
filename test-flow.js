// Автоматичний тест-прогін сайту «Оліс» (використовує pg-mem замість Neon)
const BASE = 'http://localhost:' + (process.env.PORT || 3001);
let cookie = '';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    body: opts.body ? new URLSearchParams(opts.body) : undefined,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
}

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name);
  if (!cond) failures++;
}

(async () => {
  await req('/');

  // --- 1. Кошик та оптова ціна ---
  let r = await req('/cart/add/1', { method: 'POST', body: { qty: '12', back: '/catalog' } });
  check('1.1 Товар (12 шт) додано до кошика', r.status === 302);
  let res = await req('/cart');
  let t = await res.text();
  check('1.2 Сторінка кошика відкривається', res.status === 200);
  check('1.3 Застосована оптова ціна (від 10 шт)', t.includes('оптова ціна'));
  check('1.4 Сума = 408 грн (12 × 34 опт)', t.includes('408'));

  r = await req('/cart/add/2', { method: 'POST', body: { qty: '2', back: '/cart' } });
  res = await req('/cart'); t = await res.text();
  check('1.5 Роздрібна ціна для 2 шт (28 × 2)', t.includes('56'));
  await req('/cart/remove', { method: 'POST', body: { id: '2' } });
  res = await req('/cart'); t = await res.text();
  check('1.6 Видалення позиції з кошика', !t.includes('Барвінок'));

  // --- 2. Оформлення замовлення ---
  r = await req('/checkout', {
    method: 'POST',
    body: { customer_name: 'Test Tester', phone: '380991112233', city: 'Вінниця', delivery: 'Нова пошта', payment: 'Готівка' },
  });
  check('2.1 Замовлення створено (редирект на сторінку замовлення)', r.status === 302 && (r.headers.get('location') || '').includes('/order/1'));
  res = await req('/order/1'); t = await res.text();
  check('2.2 Сторінка замовлення відкривається', res.status === 200 && t.includes('№1'));
  check('2.3 Покупець і сума в замовленні', t.includes('Test Tester') && t.includes('408'));

  // --- 3. Вхід директора та панель керування ---
  r = await req('/login', { method: 'POST', body: { login: 'director', password: 'Director2026!' } });
  check('3.1 Директор увійшов (director / Director2026!)', r.status === 302 && (r.headers.get('location') || '').includes('/admin'));
  res = await req('/admin'); t = await res.text();
  check('3.2 Панель керування відкривається', res.status === 200 && t.includes('Панель керування'));
  for (const u of ['/admin/products', '/admin/orders', '/admin/employees']) {
    res = await req(u);
    check('3.3 ' + u + ' доступна', res.status === 200);
  }
  res = await req('/admin/employees'); t = await res.text();
  check('3.4 Директор бачить працівників', t.includes('Мельник Олег Степанович'));

  // --- 4. Керування замовленням ---
  await req('/admin/orders/1/status', { method: 'POST', body: { status: 'підтверджено', back: '/admin/orders/1' } });
  res = await req('/admin/orders/1'); t = await res.text();
  check('4.1 Статус замовлення змінено', t.includes('підтверджено'));

  // --- 5. CRUD товарів ---
  await req('/admin/products', { method: 'POST', body: { name: 'Тест товар', description: 'для тесту', price_retail: '10', price_wholesale: '8', wholesale_min: '5', stock: '5', unit: 'шт', icon: '🧪' } });
  res = await req('/admin/products'); t = await res.text();
  check('5.1 Новий товар створено', t.includes('Тест товар'));
  await req('/admin/products', { method: 'POST', body: { name: 'Тест товар 2', price_retail: '11', price_wholesale: '9', stock: '3', icon: '🧪' } });
  res = await req('/catalog?q=Тест'); t = await res.text();
  check('5.2 Товар видно в каталозі покупцям', t.includes('Тест товар'));

  // --- 6. Розмежування прав (каса = лише перегляд) ---
  cookie = '';
  r = await req('/login', { method: 'POST', body: { login: 'kasa', password: 'Kasa2026!' } });
  res = await req('/admin/orders'); t = await res.text();
  check('6.1 Касир бачить замовлення', res.status === 200 && t.includes('Замовлення'));
  res = await req('/admin/products', { redirect: 'manual' });
  check('6.2 Касира заблоковано від розділу «Товари» (403)', res.status === 403);
  r = await req('/admin/orders/1/status', { method: 'POST', body: { status: 'скасовано' } });
  res = await req('/admin/orders/1'); t = await res.text();
  check('6.3 Касир може змінювати статус замовлення', t.includes('скасовано'));

  // --- 7. Невірний логін ---
  cookie = '';
  r = await req('/login', { method: 'POST', body: { login: 'director', password: 'wrong' } });
  t = await r.text();
  check('7.1 Невірний пароль відхиляється (401)', r.status === 401);

  console.log(failures ? '\nВІДМОВИ: ' + failures : '\nУСІ ТЕСТИ ПРОЙДЕНО ✔');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('ТЕСТ ВПАВ:', e.message);
  process.exit(1);
});
