# Пилот v3 (Mars Mission Training) — инструкция

Для человека без технических знаний. Нужны браузер, доступ к Supabase и —
для выгрузки и сводки — компьютер с этой папкой.

---

## 0. Один раз перед началом

1. ~~Обновить таблицу в Supabase~~ — сделано 27.09: выполнены
   `services/ingest/sql/002_v3_envelope.sql` и `003_run_mode.sql`. Без них
   сервер не сохранял ответы: с 6 сентября в базу не пришло ни одной строки.
   Проверка записи в настоящую базу, которая это ловит:

   ```bash
   node scripts/verify-ingest.mjs https://counterweight-pearl.vercel.app
   npx playwright test --config playwright.walkthrough.config.ts
   ```

   Вторая команда проходит все 4 версии на настоящем сайте (`test=true`) и
   засчитывает прохождение, только если сервер принял все события.
2. ~~Заполнить пропуски в текстах~~ — сделано: школа, email
   (dashaprokop24@gmail.com) и решение этической комиссии (14.09.2026,
   действует до 14.09.2027) вставлены в согласие и дебрифинг.

---

## 1. Ссылки

### Для участников пилота — у каждого своя

| Участник | Ссылка | Версия |
|---|---|---|
| 1 | `https://counterweight-pearl.vercel.app/?pilot=true&p=1` | тёплая Nova, список A |
| 2 | `https://counterweight-pearl.vercel.app/?pilot=true&p=2` | нейтральная Nova, список B |
| 3 | `https://counterweight-pearl.vercel.app/?pilot=true&p=3` | тёплая Nova, список B |
| 4 | `https://counterweight-pearl.vercel.app/?pilot=true&p=4` | нейтральная Nova, список A |
| 5 | `https://counterweight-pearl.vercel.app/?pilot=true&p=5` | тёплая Nova, список A |

Цифра в конце выбирает версию по кругу, поэтому пятеро гарантированно
увидят все четыре варианта.

- **Не давайте одну цифру двум людям** — они попадут в одну версию.
- **Если человек не прошёл отбор** (младше 18 или английский ниже B1), его
  цифру отдайте следующему: отказ в отборе версию не расходует.
- **Если участник закрыл вкладку** — пусть откроет ту же ссылку в том же
  браузере: исследование продолжится с того же экрана.

Участник пилота видит всё то же, что увидят настоящие участники, плюс
пометку «This is a pilot version…» в согласии и три вопроса обратной связи
перед дебрифингом. Занимает около 20 минут.

### Для вас — посмотреть каждую версию (в анализ не идут никогда)

```
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=EI-A
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=EI-B
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=Neutral-A
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=Neutral-B
```

Браузер помнит незаконченное прохождение. Чтобы начать заново — откройте
ссылку в **приватном окне** (инкогнито).

Ссылка без `pilot=true` и без `test=true` показывает «This study is not open
yet.» и ничего не записывает: основное исследование ещё не открыто.

---

## 2. Как проверить, что ответы дошли

Supabase → **SQL Editor**:

```sql
select run_mode, count(distinct session_id) as people, count(*) as events
from public.events
where participant_id is not null          -- только v3
group by run_mode;
```

- `pilot` — ваши участники;
- `test` — тестовые прохождения (мои и ваши), в анализ не идут.

### Дошёл ли конкретный человек до конца

```sql
select session_id,
       min(received_at) as started,
       max(cell) as version,
       count(*) filter (where type = 'lesson_item')     as lessons,
       count(*) filter (where type = 'mission_answer')  as tasks,
       count(*) filter (where type = 'session_completed') as finished,
       count(*) filter (where type = 'withdrawal_requested') as removed
from public.events
where run_mode = 'pilot' and participant_id is not null
group by session_id
order by started;
```

- `lessons` = **12**, `tasks` = **12**, `finished` = **1** — прошёл всё.
- Меньше — бросил на середине; по числам видно, где.
- `removed` = **1** — участник нажал «Remove my data»; его ответы
  автоматически исключаются из выгрузки и сводки.

---

## 3. Как выгрузить данные

1. В **SQL Editor** выполните и нажмите **Download CSV**:

   ```sql
   select event_id, session_id, participant_id, seq, client_ts, received_at,
          run_mode, cell, type, payload
   from public.events
   where participant_id is not null
   order by session_id, seq;
   ```

2. Сохраните файл как `data/pilot-v3-events.csv` в папке `eiai-study3`.
3. В терминале, из папки `eiai-study3`:

   ```bash
   python pipeline/v3_export.py --events data/pilot-v3-events.csv --mode pilot --out results/export_v3
   ```

В `results/export_v3/` появятся три файла:

- `events_long.csv` — одна строка = одно событие;
- `participants_wide.csv` — одна строка = один участник (открывается в Excel);
- `export.json` — всё вместе.

Участники, нажавшие «Remove my data», в эти файлы не попадают совсем.

---

## 4. Как построить сводку пилота

```bash
python scripts/pilot_v3_summary.py --events data/pilot-v3-events.csv
```

Результат: `results/pilot_v3/SUMMARY.md` — по каждому участнику и в среднем:
версия, время (всего и по модулям), время чтения сильных и слабых объяснений,
ответы в миссиях, проверка внимания, квиз, оценки Nova, оценки качества
объяснений и **дословно** ответы на вопросы в конце.

Папка `results/` не попадает в git: там ответы людей.

---

## 5. Если участник пишет об ошибке

**Сначала спросите:** телефон или компьютер, какой браузер, на каком экране
(что написано сверху), что именно произошло.

| Жалоба | Что ответить |
|---|---|
| «Страница перезагрузилась / закрыл вкладку» | Открыть ту же ссылку в том же браузере — продолжится с того же места. |
| «Пропал интернет» | Ничего не потеряно: ответы хранятся в браузере и уйдут, когда связь вернётся. Просто продолжать. |
| «Кнопка Continue не появляется» | Она появляется через 2–3 секунды после сообщения Nova. Подождать. |
| «Кнопка Next не нажимается» | Нужно выбрать и ответ, и уверенность («How sure are you?»). |
| «Кнопка “Назад” не работает» | Так задумано: вернуться к уроку во время миссии нельзя. |
| «Мне нет 18 / плохо знаю английский» | Исследование само не пускает дальше; о человеке ничего не сохраняется, кроме причины. |
| «Передумал участвовать» | На последнем экране есть кнопка **Remove my data**. |
| «Пишет “This study is not open yet”» | Ссылка скопирована не целиком — дайте ссылку заново. |

**Чего не делать:** не просить проходить заново «на всякий случай» —
повторное прохождение портит данные сильнее, чем незаконченное.

Проверить, дошли ли данные человека, можно запросом из раздела 2.

---

## 6. После пилота

1. Выгрузить данные и построить сводку (разделы 3–4).
2. Прочитать ответы на три вопроса обратной связи и воронку F1–F4.
3. Написать мне, что поправить.

Пилотные данные в основное исследование не войдут: они помечены `pilot`.
Основное распределение по группам, power analysis, модель анализа,
multiverse и пререгистрация определяются после пилота
(`docs/spec/v3/SPEC.md`).
