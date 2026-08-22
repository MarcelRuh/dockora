import { StreamLanguage } from '@codemirror/language';

/** KEY=value highlighting for Compose `.env` files. */
export const dotenvLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.sol() && stream.match(/[ \t]*#.*/)) return 'comment';
    if (stream.eatSpace()) return null;
    if (stream.match(/export\b/)) return 'keyword';
    if (stream.match(/[A-Za-z_][A-Za-z0-9_.]*/)) {
      return stream.peek() === '=' ? 'propertyName' : 'variableName';
    }
    if (stream.eat('=')) return 'operator';
    if (stream.match(/'([^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/"([^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)) return 'variableName';
    if (stream.match(/#.*/)) return 'comment';
    stream.next();
    return 'string';
  },
});
