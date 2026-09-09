// Fixed dark palette. The user doesn't like light mode -- this is permanent,
// not a system-following theme and not a user-facing toggle, so it's a plain
// flat object, not a provider/context/hook.

export const colors = {
  background: '#121212',
  surface: '#1e1e1e',
  border: '#3a3a3a',
  separator: '#2a2a2a',
  text: '#f2f2f2',
  textMuted: '#a0a0a0',
  textFaint: '#6b6b6b',
  accent: '#f2f2f2',
  accentText: '#121212',
  danger: '#ff6b5e',
  disabled: '#555555',
  shadow: '#000000',
} as const;
