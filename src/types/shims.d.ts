// markdown-it-task-lists ships no types; the plugin's contract is tiny.
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  interface TaskListsOptions {
    enabled?: boolean
    label?: boolean
  }
  const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void
  export default plugin
}

// Vite asset imports: `import url from 'x?url'`
declare module '*?url' {
  const url: string
  export default url
}
