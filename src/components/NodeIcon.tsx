import { useIcons } from '../store/icons'

/** A shell icon fetched from Rust; the spacer keeps rows from jumping while it loads. */
export function NodeIcon({ spec, size = 16 }: { spec: string; size?: number }) {
  const url = useIcons((s) => s.urls[spec])
  return url ? (
    <img
      className="node-icon"
      src={url}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  ) : (
    <span className="node-icon is-blank" style={{ width: size, height: size }} />
  )
}
