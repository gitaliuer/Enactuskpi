# Подготовка внешнего тестового размещения · 17.11.2026

## Создано с разрешения владельца

- Supabase: `Enactus Zhetysu`, проект `yyhxailxehabucfqhmaq`, регион `eu-central-1` (Франкфурт), запрошен план **free**. При создании получен ACTIVE_HEALTHY; отдельная проверка db/pooler — healthy.
- Новая база была пустой. Транзакционно применены SQL 001/002/003; журнал приложения `schema_migrations` содержит имена этих миграций. Запись в истории Supabase: `enactus_initial_private_schema`.
- RLS включён на 21 таблице; публичные политики не создавались. Прямое browser/PostgREST чтение таблиц не используется. Публичная регистрация и email/phone auth Supabase отключены: приложение использует свои приглашения и сессии.
- Vercel: проект `enactus-zhetysu`, ID `prj_Plj1tGxtxPBBs0dCmAKuko5jcaqh`, scope `team_ARaJaZRWu3MupzeAeIuctpDE` (Hobby).
- Vercel назначил домен `enactus-zhetysu.vercel.app`; интерфейс уже опубликован и проверен, **серверное соединение с БД пока не работает**.
- Созданы production-only переменные DATABASE_URL и QR_SECRET (sensitive), APP_ORIGIN, GEO_MAX_ACCURACY=100, GEO_MAX_AGE_SECONDS=30. Preview к этой базе не подключён. Сырые секреты в репозиторий не добавлялись.
- В `vercel.json` выбран fra1, в package.json Node 22.x; npm ci / npm run build.
- Исходники опубликованы исключительно в ветке `arena/589aa6b1-enactuskpi`, не в main.

## Публикация и текущий блокер

Прежний вызов create_deployment возвращал 429 GitHub API rate limit. После подключения GitHub и настройки пользователем Production Branch на текущую ветку push служебного коммита `7d7974d` запустил первую сборку. GitHub Vercel status подтвердил success. Последующие сборки `4918fc9` и `19e0b94` также завершились success; deployment `dpl_ExJpEmxNTobW14hewDhgzkyWXgrm` соответствует диагностике.

Внешний fetch главной страницы `https://enactus-zhetysu.vercel.app/` вернул страницу входа без запроса авторизации Vercel. Это подтверждает доступность интерфейса, но не вход в приложение.

**Проверка подключения:** direct endpoint возвращал `{status:"unavailable",reason:"DATABASE_NETWORK"}` на `/api/health?check=19e0b94`. Пользователь затем предоставил скриншот Supabase Connect с Transaction pooler: host `aws-1-eu-central-1.pooler.supabase.com`, port `6543`, database `postgres`, user `postgres.yyhxailxehabucfqhmaq`. Production DATABASE_URL обновлён на эти подтверждённые параметры с `sslmode=verify-full`; пароль сохранён в Sensitive Environment Variable. Требуются новый deploy и внешняя readiness-проверка после смены переменной. Платный IPv4 add-on не подключался.

Приглашённый OWNER `ali` создан в новой базе безопасной транзакцией с блокировкой system_owner; password_hash отсутствует до самостоятельной активации владельцем. Код активации не выдавался пользователю, так как сеть БД пока не работает. Если истечёт — отозвать старый и выдать новый после проверки readiness. Не создавать второго OWNER.

## Что проверить после запуска deployment

1. Получить deployment ID/state из Vercel, дождаться READY, изучать build logs только если build не прошёл.
2. Проверить runtime-соединение Vercel→PostgreSQL через Transaction pooler после redeploy. Проверка `/api/health` возвращает только readiness и безопасную категорию ошибки, не содержит учётных данных. TLS-проверку не отключать. Приложение использует неназванные параметризованные запросы pg, без session-level prepared statements, с явными BEGIN/COMMIT на выделенном клиенте транзакции.
3. Проверить ограничения публичного доступа Vercel: проект наследует SSO protection `all_except_custom_domains`. При необходимости разрешить публичный production через Dashboard, сохранив авторизацию самого приложения. Не объявлять участникам доступность, пока анонимный посетитель не видит страницу входа без требования аккаунта Vercel.
4. Внешний приглашённый OWNER `ali` создан. После восстановления сети БД безопасно выдать свежий одноразовый activation token; никакие старые preview-коды не действуют во внешней базе.
5. Проверить activation, login/logout, отсутствие доступа без сессии, запрет IDOR/расширения прав, QR/гео/CSV на тестовых данных. Секреты не помещать в build logs и чат.
6. Перед настоящими данными остаются решения о применимости Hobby, хранении/удалении, backup/restore, правовой оценке, реальном GPS и нагрузке. Free имеет лимиты и не является гарантией постоянной доступности.

Подключение приложений дало доступ на создание ресурсов, но не подтверждает успешную работу всего сайта. Не заменять эту проверку статусом здоровой БД или успешной локальной сборкой.
