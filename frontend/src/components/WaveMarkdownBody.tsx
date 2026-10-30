import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Everything that needs react-markdown and remark-gfm (~125 KB raw).
 *
 * WaveChat loads this with React.lazy, so the parser only reaches the browser
 * when a reply actually has to be rendered; the console's first paint no longer
 * pays for it.
 */
const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="wave-md-tablewrap">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export default function WaveMarkdownBody({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
}
