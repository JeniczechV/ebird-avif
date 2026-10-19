# eBird ↔ AVIF

Rozšíření prohlížeče pro přenos vlastních pozorování ptáků mezi [eBirdem](https://ebird.org) a českou faunistickou databází [AVIF](https://avif.birds.cz) České společnosti ornitologické.

- **eBird → AVIF:** najde tvoje checklisty z Česka, ukáže náhled (obec, druhy, počty) a vybrané založí v AVIFu jako seznamy. Pamatuje si, co už přeneslo, takže nic nepošle dvakrát.
- **AVIF → eBird:** z vybraných seznamů v AVIFu vytvoří CSV, které nahraješ do eBirdu přes [import](https://ebird.org/import/upload.form?theme=ebird). eBird zápis přes API neumožňuje.

Rozšíření nemá žádný server. Klíče a token zůstávají jen v tvém prohlížeči, data jdou přímo mezi prohlížečem a eBirdem/AVIFem. Viz [zásady ochrany soukromí](PRIVACY.md).

> Neoficiální nástroj. Není vyvíjen ČSO ani Cornell Lab of Ornithology.

## Instalace (zatím ručně)

1. Stáhni repozitář (zelené tlačítko **Code → Download ZIP**) a rozbal ho.
2. V Chromu nebo Edgi otevři `chrome://extensions`, vpravo nahoře zapni **Režim pro vývojáře**.
3. Klikni na **Načíst rozbalené** a vyber rozbalenou složku.
4. Klikni na ikonu rozšíření. Otevře se v nové kartě.

## Propojení účtů

1. **eBird API klíč:** vygeneruj si ho na [ebird.org/api/keygen](https://ebird.org/api/keygen) a vlož ho do záložky **Účty** spolu se svým jménem, jak se zobrazuje u checklistů.
2. **AVIF:** přihlas se svým účtem birds.cz.

## Jak se data převádějí

| eBird | AVIF |
|---|---|
| datum, čas začátku, délka | datum, čas od–do |
| kompletní checklist (vše nahlášeno) | kompletní seznam |
| příležitostné pozorování nebo nespárovaný druh | částečný seznam |
| stacionární protokol | režim „bod“, jinak „oblast“ |
| lokalita | souřadnice, název lokality, obec (podle souřadnic) |
| ušlá vzdálenost, počet pozorovatelů | vzdálenost, počet pozorovatelů |
| počet „X“ | bez počtu |
| odkaz na checklist | poznámka „Převedeno z eBirdu: …“ |

Druhy se párují podle latinských jmen, rozdíly mezi taxonomiemi řeší ruční výjimky v [`src/lib/taxonomy-build.js`](src/lib/taxonomy-build.js). Hybridy a druhy bez protějšku rozšíření nepošle a vypíše je k ručnímu doplnění.

Checklisty se hledají v denních přehledech eBirdu za Česko podle jména pozorovatele. Najdou se tak jen checklisty z ČR, což odpovídá AVIFu. Konkrétní checklist jde načíst i vložením odkazu.

Seznamy, které do AVIFu přišly z eBirdu, rozšíření nenabízí k exportu zpět (pozná je podle poznámky).

## Vývoj

```
npm test            # testy převodů (Node 20+)
npm run taxonomy    # znovu vygeneruje data/taxonomy.json z aktuálních taxonomií
npm run zip         # balíček pro Chrome Web Store
```

Struktura: `src/lib/convert.js` převody (čisté funkce), `src/lib/ebird.js` a `src/lib/avif.js` klienti API, `src/app.*` uživatelské rozhraní, `data/taxonomy.json` vygenerované párování druhů.

## Licence

MIT
