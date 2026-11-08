// Exported statements: the formats the page can ask for.

export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
