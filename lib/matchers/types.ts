export type Token = {
  type: string;
  value: string;
};

export type Tokenizer = (text: string) => Token[][];

export type MatchResult =
  | { ok: false; consumed?: number }
  | { ok: true; consumed: number };

export type Matcher = {
  tryMatch: (tokens: Token[], from: number) => { ok: boolean; consumed?: number };
  match: (tokens: Token[]) => boolean;
  // Marker flags for combinator backtracking — set by star(), spread(), repeat()
  __star?: true;
  __spread?: true;
  __repeat?: true;
  // Tokenizer function — set by tagged() via ctx.bash/ctx.nu/ctx.sql builders
  __tokenizer?: Tokenizer;
};
