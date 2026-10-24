'use strict';
// Formatação de datas para a interface (pt-BR).

/** "agora", "há 5 min", "há 3 h", "há 2 dias" ou a data. */
function timeAgo(ts, now = Date.now()) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `há ${d} dia${d > 1 ? 's' : ''}`;
  return fmtDate(ts);
}

/** "24/10/2026 14:32". */
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = { timeAgo, fmtDate };
