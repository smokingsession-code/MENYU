# Translating Menyu into Luganda

Menyu's screens are written in English in `messages/en.json`. The Luganda
version lives in `messages/lg.json`, which has exactly the same keys with
empty values. **Only a native Luganda speaker should fill these in.** Please
do not use machine translation: diners and restaurant owners will read every
word, and stiff or wrong Luganda is worse than English.

## How it works

- Any string left empty (`""`) shows in English, so the app works at every
  stage of the translation. Translate the most visible parts first.
- The diner's menu shows an English/Luganda switch only when the restaurant
  has written something in Luganda (dish names, descriptions, sections).
  Screen text such as "Add to order" uses `lg.json` once it is filled in.
- Words in braces are filled in by the app and must stay exactly as they
  are, in any order that reads naturally: `{name}`, `{count}`, `{price}`,
  `{table}`, `{restaurant}`, `{brand}`, `{date}`, `{amount}`, `{url}`.
  Example: `"addNamed": "Add {name}"` could become `"addNamed": "Gattako {name}"`.
- Keep the meaning, not the exact words. Short is better on a phone screen.

## Where to start

1. `diner`: everything a diner sees on a menu. This is the most important
   section.
2. `home` and `directory`: the public website and "Menus near me".
3. `dashboard`, `editor`, `home2`, `profile`, `tables`: what owners use daily.

See how far the translation has got, by section:

```bash
npm run i18n:status
```

List every string still to translate in one section, with its English text:

```bash
npm run i18n:status -- --todo diner
```

## After editing

Developers run `npm run i18n:sync` whenever they add English strings; it
adds the new keys to `lg.json` as `""` and keeps every translation already
made. Commit `messages/lg.json` like any other change.
