# local-ledger

A local-first, fully encrypted personal finance desktop app. Import bank CSVs, auto-categorise transactions, set budgets, see monthly charts and export reports. Your data never leaves your computer.

> Status: in development. See [docs/TASKS.md](docs/TASKS.md).

## Importing bank files

Import CSV exports from any bank: the column wizard maps the date, amount and description. CommBank, NAB, ANZ and Westpac files are recognised without it. Their layouts come from open-source parsers and their published sample files, since the banks do not document them, and have not been checked against real exports; a file the app does not recognise opens in the column wizard.

If a bank file is not read correctly, `npm run csv:shape -- <file.csv>` prints a report of its structure (columns, date and amount formats, encoding) that contains none of its data, to attach to an issue.

## Budgets, reports and exports

Set a monthly budget per category and see how much is left; the sidebar counts categories over budget. Reports chart twelve months of income and spending, spending by category, and a category's trend; transfers between your own accounts are left out. A month's statement exports to Excel or PDF. Exported files are not encrypted.

## Docs

- [Specification](docs/SPEC.md)
- [Design decisions](docs/DECISIONS.md)

## License

MIT
