// TypeScript declarations for styles handled by Expo/Metro and the web bundler.
// These declarations provide types only; they do not change runtime CSS handling.
declare module '*.css';

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
