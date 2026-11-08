# Sample bank exports

Hand-made files in the layouts of bank CSV exports. Every merchant, amount, date and account number is made up.

| File | Layout | Covers |
|---|---|---|
| `commbank.csv` | CommBank NetBank: no header; date, signed amount, description, balance | quotes and commas in a description, thousands separator, identical rows on one day, no final line break |
| `commbank-bom-crlf.csv` | as above | UTF-8 byte order mark, CRLF |
| `nab.csv` | NAB Internet Banking, 2026 header with `Processed On` | `29 May 26` dates, a row without merchant, a short row |
| `nab-2022.csv` | NAB, 2022 header | full month names, CRLF |
| `anz.csv` | ANZ Internet Banking: no header; date, signed amount, description | |
| `anz-extended.csv` | ANZ with five more columns | |
| `westpac.csv` | Westpac Live: header; separate debit and credit | two accounts in one file |
| `other-bank.csv` | a layout no template knows | the generic column guess |

The layouts follow open-source parsers written against real exports (D024); the banks do not publish them.
