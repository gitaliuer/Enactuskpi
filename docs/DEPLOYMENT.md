# Подготовка внешнего тестового размещения · 17.11.2026

## Создано с разрешения владельца

- Supabase: `Enactus Zhetysu`, проект `yyhxailxehabucfqhmaq`, регион `eu-central-1` (Франкфурт), запрошен план **free**. При создании получен ACTIVE_HEALTHY; отдельная проверка db/pooler — healthy.
- Новая база была пустой. Транзакционно применены SQL 001/002/003; журнал приложения `schema_migrations` содержит имена этих миграций. Запись в истории Supabase: `enactus_initial_private_schema`.
- RLS включён на 21 таблице; публичные политики не создавались. Прямое browser/PostgREST чтение таблиц не используется. Публичная регистрация и email/phone auth Supabase отключены: приложение использует свои приглашения и сессии.
- Vercel: проект `enactus-zhetysu`, ID `prj_Plj1tGxtxPBBs0dCmAKuko5jcaqh`, scope `team_ARaJaZRWu3MupzeAeIuctpDE` (Hobby).
- Vercel назначил домен `enactus-zhetysu.vercel.app`, **это ещё не проверенный работающий сайт**.
- Созданы production-only переменные DATABASE_URL и QR_SECRET (sensitive), APP_ORIGIN, GEO_MAX_ACCURACY=100, GEO_MAX_AGE_SECONDS=30. Preview к этой базе не подключён. Сырые секреты в репозиторий не добавлялись.
- В `vercel.json` выбран fra1, в package.json Node 22.x; npm ci / npm run build.
- Исходники опубликованы исключительно в ветке `arena/589aa6b1-enactuskpi`, не в main.

## Текущий блокер

Вызов Vercel create_deployment с target=production и Git source текущей ветки вернул:

> 429 Too Many Requests — GitHub API rate limit exceeded. Please retry after a few minutes.

Deployment ID не получен. Этот запрос в том же ходе повторно не отправлялся. Публикация не подтверждена. Следующий шаг — после снятия лимита снова запросить deployment в существующий проект. Не создавать второй проект для обхода лимита.

Если Vercel затем потребует `projectSettings`/первичное подтверждение autodetection: подключённый connector эти поля не поддерживает. Нужно завершить первичную настройку в интерфейсе Vercel, не пытаться прятать параметры в git_source.

## Что проверить после запуска deployment

1. Получить deployment ID/state из Vercel, дождаться READY, изучать build logs только если build не прошёл.
2. Проверить runtime-соединение Vercel→PostgreSQL. Сейчас DATABASE_URL указывает на официальный direct host из get_project с TLS verify-full; адрес транзакционного Supavisor pooler connector не предоставил. Если сеть runtime не поддерживает direct endpoint или исчерпывается лимит соединений — получить настоящий pooled URL через Supabase Connect и безопасно обновить DATABASE_URL, не угадывать адрес пулера и не отключать проверку сертификатов.
3. Проверить ограничения публичного доступа Vercel: проект наследует SSO protection `all_except_custom_domains`. При необходимости разрешить публичный production через Dashboard, сохранив авторизацию самого приложения. Не объявлять участникам доступность, пока анонимный посетитель не видит страницу входа без требования аккаунта Vercel.
4. Внешний OWNER пока не создан. Создать ровно одного приглашённого `ali`, безопасно выдать одноразовый activation token; никакие старые preview-коды не действуют во внешней базе.
5. Проверить activation, login/logout, отсутствие доступа без сессии, запрет IDOR/расширения прав, QR/гео/CSV на тестовых данных. Секреты не помещать в build logs и чат.
6. Перед настоящими данными остаются решения о применимости Hobby, хранении/удалении, backup/restore, правовой оценке, реальном GPS и нагрузке. Free имеет лимиты и не является гарантией постоянной доступности.

Подключение приложений дало доступ на создание ресурсов, но не подтверждает успешную работу всего сайта. Не заменять эту проверку статусом здоровой БД или успешной локальной сборкой.
