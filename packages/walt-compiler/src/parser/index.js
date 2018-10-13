/*
 * Syntax Analysis
 *
 * The parser below creates the "bare" Abstract Syntax Tree.
 */

// @flow
import invariant from 'invariant';
import Syntax, { tokens } from 'walt-syntax';
import moo from 'moo';
import curry from 'curry';
// $FlowFixMe
import coreGrammar from './grammar/grammar.ne';
// $FlowFixMe
import defaultArgsGrammar from '../syntax-sugar/default-arguments.ne';
import { Parser, Grammar } from 'nearley';
import helpers from './grammar/helpers';
import nodes from './grammar/nodes';
import type { NodeType } from '../flow/types';

type GrammarType = {
  Lexer: any,
  ParserRules: Object[],
  ParserStart: string,
};
type MakeGrammar = () => GrammarType;

/*
 * Returns a custom lexer. This wrapper API is necessary to ignore comments
 * in all of the subsequent compiler phases, unfortunately.
 *
 * TODO: Maybe consider adding comment nodes back to the AST. IIRC this causes
 *       lots of ambiguous grammar for whatever reason.
 */
function makeLexer() {
  const mooLexer = moo.compile(tokens);

  return {
    current: null,
    lines: [],
    get line() {
      return mooLexer.line;
    },
    get col() {
      return mooLexer.col;
    },
    save() {
      return mooLexer.save();
    },
    reset(chunk, info) {
      this.lines = chunk.split('\n');
      return mooLexer.reset(chunk, info);
    },
    next() {
      // It's a cruel and unusual punishment to implement comments with nearly
      let token = mooLexer.next();
      // Drop all comment tokens found
      while (token && token.type === 'comment') {
        token = mooLexer.next();
      }
      this.current = token;
      return this.current;
    },
    formatError(token) {
      return mooLexer.formatError(token);
    },
    has(name) {
      return mooLexer.has(name);
    },
  };
}

/**
 * Creates the "bare" Abstract Syntax Tree.
 *
 * @name makeParser
 * @param {MakeGrammar[]} extraGrammar
 * @param {string}        source
 */
export default curry(function parse(
  extraGrammar: MakeGrammar[],
  source: string
): NodeType {
  const grammarList = [coreGrammar, defaultArgsGrammar, ...extraGrammar];
  const context = {
    lexer: makeLexer(),
    nodes,
    helpers,
    Syntax,
  };

  // All Grammar plugins are factories resulting in an object which must contain
  // a "ParserRules" array which will be added to the base grammar.
  const grammar = grammarList.slice(1).reduce((acc: any, value: Function) => {
    const extra = value.call(context);
    return {
      ...acc,
      ParserRules: acc.ParserRules.concat(extra.ParserRules),
    };
  }, grammarList[0].call(context));

  const parser = new Parser(Grammar.fromCompiled(grammar));

  parser.feed(source);

  // This is a safeguard against ambiguous syntax that may be generated by blending
  // multiple different grammars together. If there is more than one was to parse
  // something then we did something wrong and we hard exit the compiler pipeline.
  invariant(
    parser.results.length === 1,
    `Ambiguous syntax number of productions: ${parser.results.length}`
  );

  return parser.results[0];
});
