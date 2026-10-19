# Zásady ochrany soukromí

Rozšíření eBird ↔ AVIF nemá žádný vlastní server a nesbírá žádná data.

- **Co se ukládá:** eBird API klíč, jméno v eBirdu, přihlašovací token k AVIFu a seznam už přenesených checklistů. Vše jen v úložišti tvého prohlížeče (`chrome.storage.local`). Heslo k birds.cz se neukládá.
- **Kam se data posílají:** jen přímo do služeb, se kterými pracuješ: `api.ebird.org` (čtení tvých checklistů), `login.birds.cz` a `avif.birds.cz` (přihlášení a zápis seznamů), `projekty.birds.cz` (určení obce podle souřadnic).
- **Komu:** nikomu dalšímu. Autor rozšíření k tvým datům nemá přístup.
- **Smazání:** odinstalováním rozšíření se smaže všechno uložené.
