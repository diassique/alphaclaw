# Комплексный аудит AlphaClaw — готовность к конкуренции

## Общая оценка: 6.5/10

Проект архитектурно сильный, но имеет критические дыры, которые судьи заметят сразу.

---

## КРИТИЧЕСКИЕ БАГИ (исправить немедленно)

### 1. Цена sentiment: 10x overcharge
`src/services/sentiment/index.ts:15` — paywall берёт `$0.01`, а `SERVICE_DEFS` и документация говорят `$0.001`. Судья увидит несоответствие.

### 2. `x-internal: bypass` — любой может обойти paywall
`src/lib/paywall.ts:51-54` — заголовок `x-internal: bypass` не проверяет IP/секрет. Любой внешний клиент может отправить этот header и получить данные бесплатно.

### 3. `POST /hunt` — нет try/catch
`src/agent/routes/hunt.ts:20-144` — async handler без обёртки. Если `callAllServices()` бросит ошибку, Express вернёт 500 с полным стектрейсом.

### 4. Краш при отсутствии `web/dist`
`src/agent/routes/pages.ts:9` — `readFileSync` на верхнем уровне модуля. Если `web:build` не запущен, координатор падает при импорте.

### 5. Telegram webhook без аутентификации
`src/agent/routes/telegram.ts:27-56` — нет проверки подписи Telegram Bot API. Любой может триггерить hunts и управлять autopilot.

---

## АРХИТЕКТУРА — что сильно

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Multi-agent оркестрация | **9/10** | Параллельные вызовы, circuit breakers, competing agents, dynamic registry |
| Service-factory паттерн | **8/10** | Чистый, единообразный, 5 из 6 сервисов используют |
| Типизация | **9/10** | Ноль TS ошибок, всего 5 оправданных `as any` |
| Разделение ответственности | **8/10** | Чёткие модули: orchestrator, synthesis, reputation, memory, settlement |
| Store абстракция | **8/10** | Персистенция в JSON с eviction, flush, destroy |

---

## АРХИТЕКТУРА — что слабо

| Проблема | Где |
|----------|-----|
| Дублирование payment log | `hunt.ts`, `stream.ts`, `autopilot.ts` — три копии |
| Дублирование sentiment competition | `orchestrator.ts:107-145` и `stream.ts:176-198` |
| Hardcoded цены в stream report | `stream.ts:241` — `totalPaid: "$0.039"` не учитывает dynamic pricing |
| `isClaudeEnabled()` всегда `true` | `claude.ts:16` — 60s таймаут если Claude bridge не запущен |
| Wallet RPC URL игнорирует конфиг | `wallet.ts:27` — hardcoded `sepolia.base.org` вместо `config.baseRpcUrl` |
| `sentiment-v2` без ACP заголовков | v1 шлёт `X-ACP-*`, v2 — нет |

---

## БЕЗОПАСНОСТЬ

| Уровень | Проблема |
|---------|----------|
| **HIGH** | `x-internal: bypass` без аутентификации |
| **HIGH** | Telegram webhook без signature verification |
| **MEDIUM** | `POST /reputation/reset` без auth — кто угодно обнулит репутации |
| **MEDIUM** | `POST /moltbook/config` — API ключ можно подменить по HTTP |
| **MEDIUM** | Нет rate limiting ни на одном endpoint |
| **LOW** | CORS `*` по умолчанию с разрешённым `X-PAYMENT` заголовком |

---

## ДЕМО — что увидят судьи

### Frontend (React SPA) — 7/10
**Сильно:** тёмная тема с градиентами, 10 страниц, SSE стриминг, адаптивный дизайн, анимации.

**Слабо:**
- **ACP страница НЕ СУЩЕСТВУЕТ.** 383 строки бэкенда, 6 API роутов, типы в фронтенде — но ноль UI. Самая уникальная фича невидима.
- SSE стрим не слушает `acp:consensus`, `acp:settle`, `acp:votes`, `reputation`, `settlement` — 5 из 12 событий молча игнорируются
- Диаграмма payment flow статична (нет анимированных частиц/денег между нодами)
- Нет loading скелетонов — везде просто "Loading..."
- Нет анимаций переходов между страницами

### Demo script (`demo.ts`) — 4/10
- Показывает только 3 из 5 сервисов (нет news, whale)
- Неправильные цены ($0.01 вместо $0.001)
- Синтез фейковый — не вызывает настоящий `/hunt`
- Не показывает SSE streaming
- Не показывает ACP

### README — 4/10
- Описывает 4 сервиса вместо 6+
- Не упоминает ACP, autopilot, reputation, memory, settlement, marketplace, telegram, moltbook
- Неправильные команды запуска (`node` вместо `tsx`)
- Нет скриншотов/GIF

---

## x402 ПЛАТЕЖИ — главная фича

| Аспект | Оценка |
|--------|--------|
| Интеграция с реальными библиотеками (`x402-express`, `x402/client`) | Да |
| Retry с exponential backoff | Да |
| Graceful fallback в demo mode | Да |
| **Реальные on-chain платежи при демо** | **Нет** — `x-internal: bypass` обходит всё на localhost |
| Dynamic pricing по репутации | Да, но stream route использует hardcoded цены |

**Главная проблема:** судья увидит `"demoMode": true` везде. Реальный x402 flow работает только при деплое сервисов на разные хосты.

---

## ACP (Alpha Consensus Protocol) — 6/10

**Что хорошо:** stake-weighted voting, slash/reward механика, persistence, REST API, `/acp/spec`.

**Что плохо:**
- Стейки виртуальные — нет экономических последствий
- Консенсус против мнения большинства, а не против реальности
- Дублирует систему reputation (два параллельных scoring)
- **Полностью невидим в UI**

---

## ИНФРАСТРУКТУРА

| Аспект | Статус |
|--------|--------|
| Тесты | **Ноль.** Нет фреймворка, нет файлов, нет `npm test` |
| Линтинг | **Нет.** Ни eslint, ни prettier |
| CI/CD | **Нет.** Ни GitHub Actions, ни pipeline |
| Docker | **Нет.** Ни Dockerfile, ни docker-compose |
| `.env.example` | **12 переменных не документированы** (Claude, Telegram, Autopilot, sentiment-v2) |
| `engines` в package.json | **Не указан.** Требует Node 22+ но не декларирует |

---

## ЧТО ЕСТЬ У КОНКУРЕНТОВ, А У ВАС НЕТ

1. **On-chain верификация** — commitment в смарт-контракт, settlement на чейне
2. **Wallet Connect** — юзер может платить из своего кошелька через UI
3. **LLM-powered агенты** — каждый агент с function calling, а не API wrapper
4. **Стриминг рассуждений** — видно как LLM думает в реалтайме
5. **Бэктестинг** — проверка стратегии на исторических данных
6. **Тесты + CI** — значок "passing" в README

---

## ТОП-10 ДЕЙСТВИЙ ДЛЯ ПОБЕДЫ (по приоритету)

| # | Действие | Импакт | Усилия |
|---|----------|--------|--------|
| 1 | Создать ACP страницу в UI (лидерборд, раунды, slashes) | Критично | 2-3ч |
| 2 | Исправить критические баги (цена sentiment, try/catch, pages.ts) | Критично | 30мин |
| 3 | Обновить README со скриншотами, всеми фичами, правильными командами | Высокий | 1ч |
| 4 | Подключить 5 потерянных SSE событий в useHuntStream | Высокий | 1ч |
| 5 | Убрать `x-internal: bypass` или защитить shared secret | Высокий | 20мин |
| 6 | Сделать SSE truly progressive (стримить по одному, а не batch) | Средний | 1-2ч |
| 7 | Обновить demo.ts: все 5 сервисов, правильные цены, SSE mode | Средний | 1ч |
| 8 | Добавить animated payment flow visualization | Средний | 2-3ч |
| 9 | Обновить `.env.example` (12 пропущенных переменных) | Средний | 15мин |
| 10 | Добавить базовые unit тесты для synthesis + sentiment | Низкий | 1-2ч |

---

## ДЕТАЛЬНЫЕ НАХОДКИ

### Код — мелкие проблемы

- `src/services/sentiment/index.ts:53` — текст пересплитится на каждой итерации цикла (O(n*m) вместо O(n+m))
- `src/services/sentiment/lexicon.ts` — `overbought` одновременно в BULL_WORDS и BEAR_WORDS; дубликаты `launch`/`upgrade`
- `src/agent/memory.ts:109-130` — комбинаторный взрыв в `signalCombos()`: при 20 сигналах = 1330 комбинаций * 500 entries = 665k операций фильтрации на каждый hunt
- `src/agent/settlement.ts:23` — `SETTLEMENT_DELAY_MS` hardcoded, нет env переменной
- `src/agent/circuit-breaker.ts:7-8` — `FAILURE_THRESHOLD` и `OPEN_DURATION_MS` hardcoded
- `src/agent/claude.ts:11-13` — `BRIDGE_URL`, `MODEL` hardcoded, дублируют config
- `src/agent/settlement.ts:259` — pending массив растёт бесконечно если settlements не резолвятся
- `src/agent/routes/stream.ts:241` — hardcoded `totalPaid: "$0.039"`
- `src/demo.ts` — ссылается на устаревшие цены ($0.01 за sentiment, $0.045 total)

### Зависимости

- `viem` specifier `^2.0.0` слишком широкий — 46 минорных версий дрифта
- Нет `engines` поля в package.json (Node 22+ не декларирован)
- `.env.example` покрывает ~50% реальных переменных

### Process management (start-all.ts)

- Restart counter никогда не сбрасывается — 5 крашей за 12 часов = сервис убит навсегда
- `env: process.env` передаёт все секреты (включая AGENT_PRIVATE_KEY) всем дочерним процессам
- Startup banner hardcoded — не обновится при изменении списка сервисов

### Дублирование кода

- Payment log construction: 3 копии (hunt.ts, stream.ts, autopilot.ts)
- Sentiment competition logic: 2 копии (orchestrator.ts, stream.ts)
- sentiment-v2: полная копия sentiment-v1 кроме двух множителей (должна быть shared scoring функция)
