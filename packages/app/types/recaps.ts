// Session recaps: the write-up of what happened, plus recap notes uploaded as files

/** Files that can be attached to a recap. .txt/.md are read into the recap text instead. */
export const RECAP_FILE_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
] as const

/** Plain text files whose content goes straight into the recap */
export const RECAP_TEXT_EXTENSIONS = ['.txt', '.md'] as const

export const MAX_RECAP_FILE_BYTES = 25 * 1024 * 1024

export const fileExtension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export const isRecapTextFile = (name: string) =>
  (RECAP_TEXT_EXTENSIONS as readonly string[]).includes(fileExtension(name))

export const isAllowedRecapFile = (name: string) =>
  (RECAP_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(name))

export interface RecapFile {
  id: number
  sessionId: number
  fileName: string
  /** Relative to the uploads folder, served at /uploads/<storedName> */
  storedName: string
  sizeBytes: number
  createdAt: string
}

export interface SessionRecap {
  sessionId: number
  sessionNumber: number | null
  title: string
  date: string | null
  recap: string | null
  files: RecapFile[]
}
