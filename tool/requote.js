// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>,
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>


import * as fs from 'fs';
import Stream from 'stream';
import assert from 'assert';
import ConditionalDatasetSplitter from '../lib/dataset-tools/conditional-splitter';

import * as i18n from '../lib/i18n';

import { DatasetParser, DatasetStringifier } from '../lib/dataset-tools/parsers';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as StreamUtils from '../lib/utils/stream-utils';

const ENTITY_MATCH_REGEX = /^([A-Z].*)_[0-9|۰-۹]+$/;
const NUMBER_MATCH_REGEX = /^([0-9|۰-۹]+)$/;
const SMALL_NUMBER_REGEX = /^-?(۱۰|۱۱|۱۲|10|11|12|[0-9|۰-۹])$/;


function doReplaceNumbers(token, requote_numbers) {
    // 1) check if token is an Arabic or English number

    return requote_numbers && NUMBER_MATCH_REGEX.test(token);
}

function findSpanContaining(index, spansBySentencePos) {
    for (let i = 0; i < spansBySentencePos.length; i++) {
        const span = spansBySentencePos[i];
        if (index >= span.begin && index < span.end)
            return span;
    }
    return false;
}

function substringIsFound(sequence, substring, i) {
    for (let j = 0; j < substring.length; j++) {
        if (sequence[i+j] !== substring[j])
            return false;
    }
    return true;
}


function findSubstring(sequence, substring, spansBySentencePos, allowOverlapping, handle_heuristics=false, param_locale='en-US') {
    let paramLangPack = i18n.get(param_locale);
    let parsedWithArticle = false;
    let allFoundIndices = [];
    for (let i = 0; i < sequence.length - substring.length + 1; i++) {
        let found = substringIsFound(sequence, substring, i);
        if (handle_heuristics) {
            if (!found) {
                let pluralised_substring = paramLangPack.pluralize(substring.join(' ')).split(' ');
                if (pluralised_substring.join(' ') === substring.join(' '))
                    pluralised_substring = (substring.join(' ') + 's').split(' ');
                found = substringIsFound(sequence, pluralised_substring, i);
            }
            if (!found) {
                let article_added_substring = paramLangPack.addDefiniteArticle(substring. join(' ')).split(' ');
                found = substringIsFound(sequence, article_added_substring, i);
                // need to include the definitive article when requoting sentence
                if (found)
                    parsedWithArticle = true;
            }
        }
        if (found && (allowOverlapping || !findSpanContaining(i, spansBySentencePos))) {
            if (allowOverlapping)
                allFoundIndices.push([i, parsedWithArticle]);
            else
                return [i, parsedWithArticle];
        }
    }
    if (allowOverlapping)
        return allFoundIndices;
    else
        return [-1, false];
}

function getEntityType(entityMarker) {
    switch (entityMarker) {
    case '^^tt:hashtag':
        return 'HASHTAG';
    case '^^tt:username':
        return 'USERNAME';
    case '^^tt:phone_number':
        return 'PHONE_NUMBER';
    default:
        return 'GENERIC_ENTITY_' + entityMarker.substring(2);
    }
}

function findSpanType(program, begin_index, end_index, requote_numbers, string_number) {
    let spanType;
    if (program[begin_index-2] === 'location:' ||
        program[begin_index-3] === 'Location') { // new Location ( " ..., in new syntax
        spanType = 'LOCATION';
    } else if ((program[end_index+1] || '').startsWith('^^')) {
        spanType = getEntityType(program[end_index+1]);
    } else if ((program[begin_index-3] || '').startsWith('^^') && program[begin_index-4] === 'null') { // null ^^com.foo ( " ..., in new syntax
        spanType = getEntityType(program[begin_index-3]);
    } else if (doReplaceNumbers(program[begin_index], requote_numbers)
        && !(program[end_index+1].startsWith('^^'))){
        // catch purely numeric postal_codes or phone_numbers
        if (string_number)
            spanType = 'QUOTED_STRING';
        else
            spanType = 'NUMBER';
    } else {
        spanType = 'QUOTED_STRING';
    }
    return spanType;
}


function createProgram(program, spansByProgramPos, entityRemap, requote_numbers, ignoredProgramSpans) {
    let in_string = false, in_location = false, in_entity = false;
    let newProgram = [];
    let programSpanIndex = 0;

    for (let i = 0; i < program.length; i++) {
        let token = program[i];
        if (token === '"') {
            in_string = !in_string;
            if (in_string)
                continue;
            const currentSpan = spansByProgramPos[programSpanIndex];
            if (!currentSpan.sentenceSpan || !currentSpan.sentenceSpan.mapTo)
                console.log(spansByProgramPos);
            assert(currentSpan.sentenceSpan.mapTo);

            newProgram.push(currentSpan.sentenceSpan.mapTo);
            programSpanIndex++;
            continue;
        }
        if (in_string)
            continue;
        // handle "new Location ( ... )" in new syntax
        if ((token === 'new' && program[i+1] === 'Location' &&
             program[i+3] === '"') ||
            (token === 'Location' && program[i+2] === '"'))
            continue;
        // handle "null ^^com.foo ( ... )" in new syntax
        if (token === 'null' && (program[i+1] || '').startsWith('^^'))
            continue;
        if (token === '(' && program[i-1] === 'Location' && program[i+1] === '"') {
            in_location = true;
            continue;
        }
        if (token === '(' && program[i-2] === 'null' && program[i-1].startsWith('^^')) {
            in_entity = true;
            continue;
        }
        if (token === ')' && (in_location || in_entity)) {
            in_location = false;
            in_entity = false;
            continue;
        }
        if (token === 'location:' || token.startsWith('^^'))
            continue;

        if (ENTITY_MATCH_REGEX.test(token)) {
            assert(entityRemap[token]);
            newProgram.push(entityRemap[token]);
        } else if (doReplaceNumbers(token, requote_numbers)){
            const currentSpan = spansByProgramPos[programSpanIndex];
            if (!currentSpan || findSpanContaining(i, ignoredProgramSpans)) {
                newProgram.push(token);
                continue;
            }
            newProgram.push(currentSpan.sentenceSpan.mapTo);
            programSpanIndex++;
        } else {
            newProgram.push(token);
        }
    }
    return newProgram;
}

function qpisSentence(sentence, spansBySentencePos) {

    let current_span_idx = 0;
    let current_span = spansBySentencePos[0];

    let newSentence = [];
    let i = 0;
    let in_string = false;
    while (i < sentence.length) {
        let word = sentence[i];
        if (current_span === null || i < current_span.begin) {
            newSentence.push(word);
            i += 1;
        } else if (i >= current_span.end) {
            newSentence.push('"');
            in_string = false;
            current_span_idx += 1;
            current_span = current_span_idx < spansBySentencePos.length ? spansBySentencePos[current_span_idx] : null;
        } else if (i === current_span.begin || in_string) {
            if (i === current_span.begin)
                newSentence.push('"');
            newSentence.push(word);
            in_string = true;
            i += 1;

        } else {
            i += 1;
        }
    }
    if (in_string)
        newSentence.push('"');
    return newSentence;

}

function createSentence(sentence, contextEntities, spansBySentencePos) {

    let current_span_idx = 0;
    let current_span = spansBySentencePos[0];

    let newSentence = [];
    let entityNumbers = {};
    let entityRemap = {};
    for (let entity of contextEntities) {
        const [, type, num] = /^(.+)_([0-9]+)$/.exec(entity);
        entityNumbers[type] = Math.max(parseInt(num)+1, entityNumbers[type] || 0);
        entityRemap[entity] = entity;
    }

    function getEntityNumber(entityType) {
        let nextId = (entityNumbers[entityType] || 0);
        entityNumbers[entityType] = nextId + 1;
        return String(nextId);
    }

    let i = 0;
    while (i < sentence.length) {
        let word = sentence[i];
        if (current_span === null || i < current_span.begin) {
            const entityMatch = ENTITY_MATCH_REGEX.exec(word);
            if (entityMatch !== null) {
                // input sentence contains entities
                const newEntity = entityMatch[1] + '_' + getEntityNumber(entityMatch[1]);
                entityRemap[word] = newEntity;
                newSentence.push(newEntity);
            } else {
                newSentence.push(word);
            }
            i += 1;
        } else if (i === current_span.begin) {
            const newEntity = current_span.type + '_' + getEntityNumber(current_span.type);
            current_span.mapTo = newEntity;
            newSentence.push(newEntity);
            i += 1;
        } else if (i >= current_span.end) {
            current_span_idx += 1;
            current_span = current_span_idx < spansBySentencePos.length ? spansBySentencePos[current_span_idx] : null;
        } else {
            i += 1;
        }
    }

    return [newSentence, entityRemap];

}


function getProgSpans(program, requote_numbers) {
    let in_string = false;
    let begin_index = null;
    let end_index = null;
    let span_type = null;
    let allProgSpans = [];
    for (let i = 0; i < program.length; i++) {
        let token = program[i];
        if (token === '"') {
            in_string = !in_string;
            if (in_string) {
                begin_index = i + 1;
            } else {
                end_index = i;
                span_type = findSpanType(program, begin_index, end_index, requote_numbers, true);
                let prog_span = {begin: begin_index, end: end_index, span_type:span_type};
                allProgSpans.push(prog_span);
            }
        } else if (!in_string && doReplaceNumbers(token, requote_numbers)){
            begin_index = i;
            end_index = begin_index + 1;
            span_type = findSpanType(program, begin_index, end_index, requote_numbers, false);
            let prog_span = {begin: begin_index, end: end_index, span_type:span_type};
            allProgSpans.push(prog_span);
        }
    }

    // sort params based on length so that longer phrases get matched sooner
    allProgSpans.sort((a, b) => {
        const { begin:abegin, end:aend } = a;
        const { begin:bbegin, end:bend } = b;
        return (bend - bbegin) - (aend - abegin);
    });
    return allProgSpans;
}


function findSpanPositions(id, sentence, program, requote_numbers, handle_heuristics, param_locale) {
    const spansBySentencePos = [];
    const spansByProgramPos = [];

    let ignoredProgramSpans = [];

    // allProgSpans is sorted by length (longest first)
    const allProgSpans = getProgSpans(program, requote_numbers);

    for (const progSpan of allProgSpans) {
        let [begin_index, end_index, span_type] = [progSpan.begin, progSpan.end, progSpan.span_type];
        const substring = program.slice(begin_index, end_index);

        // first try without overlapping parameters, then try with overlapping parameters
        // (this is mostly useful for parameters that used twice, which happens in some dialogue dataset)
        let [idx, parsedWithArticle] = findSubstring(sentence, substring, spansBySentencePos, false /* allow overlapping */, handle_heuristics, param_locale);
        if (idx < 0) {
            // skip requoting "small" numbers that do not exist in the sentence
            if (SMALL_NUMBER_REGEX.test(substring)) {
                ignoredProgramSpans.push({begin: begin_index, end: end_index, type: span_type});
                continue;
            } else {
                let allFoundIndices = findSubstring(sentence, substring, spansBySentencePos, true /* allow overlapping */, handle_heuristics, param_locale);
                if (!allFoundIndices.length) {
                    throw new Error(`Cannot find span ${substring.join(' ')} in sentence id ${id}`);
                } else {
                    // in rare cases, program span tokens might be present in multiple sentence spans
                    // so we check all of them one by one until a full span match is found

                    for (let i = 0; i < allFoundIndices.length; i++) {
                        let [idx, parsedWithArticle] = allFoundIndices[i];
                        const overlappingSpan = findSpanContaining(idx, spansBySentencePos);
                        if (!overlappingSpan || idx !== overlappingSpan.begin || idx + end_index - begin_index + parsedWithArticle !== overlappingSpan.end) {
                            if (i === spansBySentencePos.length)
                                throw new Error(`Found span ${substring.join(' ')} that overlaps another span but is not identical in sentence id ${id}`);
                        } else {
                            // otherwise, the two spans are identical, so we don't create a new span
                            spansByProgramPos.push({
                                begin: begin_index,
                                end: end_index,
                                sentenceSpan: overlappingSpan
                            });
                            break;
                        }
                    }
                    continue;
                }
            }
        }

        const sentenceSpanBegin = idx;
        const sentenceSpanEnd = idx + end_index - begin_index + parsedWithArticle;
        const spanType = span_type;

        const sentenceSpan = { begin: sentenceSpanBegin, end: sentenceSpanEnd, type: spanType, mapTo: undefined };
        spansBySentencePos.push(sentenceSpan);
        spansByProgramPos.push({
            begin: begin_index,
            end: end_index,
            sentenceSpan: sentenceSpan
        });
    }

    // sort by program position after matching is done
    spansByProgramPos.sort((a, b) => {
        return a.begin - b.begin;
    });
    return [spansBySentencePos, spansByProgramPos, ignoredProgramSpans];
}


function requoteSentence(id, context, sentence, program, mode, requote_numbers, handle_heuristics, param_locale) {
    sentence = sentence.split(' ');
    program = program.split(' ');

    let contextEntities = new Set;
    if (context) {
        for (let token of context.split(' ')) {
            if (/^[A-Z].*_[0-9|۰-۹]/.test(token)) // match strings like QUOTED_STRING_0, NUMBER_0 and GENERIC_ENTITY_uk.ac.cam.multiwoz.Hotel:Hotel_0
                contextEntities.add(token);
        }
    }

    let [spansBySentencePos, spansByProgramPos, ignoredProgramSpans] = findSpanPositions(id, sentence, program, requote_numbers, handle_heuristics, param_locale);

    if (spansBySentencePos.length === 0)
        return [sentence.join(' '), program.join(' ')];

    spansBySentencePos.sort((a, b) => {
        const {begin:abegin, end:aend} = a;
        const {begin:bbegin, end:bend} = b;
        if (abegin < bbegin)
            return -1;
        if (bbegin < abegin)
            return +1;
        if (aend < bend)
            return -1;
        if (bend < aend)
            return +1;
        return 0;
    });

    let newSentence, newProgram, entityRemap;

    if (mode === 'replace'){
        [newSentence, entityRemap] = createSentence(sentence, contextEntities, spansBySentencePos);
        newProgram = createProgram(program, spansByProgramPos, entityRemap, requote_numbers, ignoredProgramSpans);
    } else if (mode === 'qpis') {
        newSentence = qpisSentence(sentence, spansBySentencePos);
        newProgram = program;
    }

    return [newSentence.join(' '), newProgram.join(' ')];
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('requote', {
        add_help: true,
        description: "Requote a dataset."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--mode', {
        type: String,
        help: 'Type of requoting (replace with placeholder, or just add quotation marks around params)',
        choices: ['replace', 'qpis'],
        default: 'replace'
    });
    parser.add_argument('--requote-numbers', {
        action: 'store_true',
        help: 'Requote numbers',
        default: false
    });
    parser.add_argument('--skip-errors', {
        action: 'store_true',
        help: 'Skip examples that we are unable to requote',
        default: false
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to evaluate (in TSV format); use - for standard input'
    });
    parser.add_argument('--handle-heuristics', {
        action: 'store_true',
        help: 'Handle cases where augmentation introduced non-matching parameters in sentence and program',
        default: false
    });
    parser.add_argument('--param-locale', {
        type: String,
        help: 'BGP 47 locale tag of the language for parameter values',
        default: 'en-US'
    });
    parser.add_argument('--output-errors', {
        type: fs.createWriteStream,
        help: 'If provided, examples which fail to be requoted are written in this file as well as being printed to stdout '
    });
}

export async function execute(args) {
    const promises = [];

    let outputErrors = null;
    const output = new DatasetStringifier();
    promises.push(StreamUtils.waitFinish(output.pipe(args.output)));
    if (args.output_errors) {
        outputErrors = new DatasetStringifier();
        promises.push(StreamUtils.waitFinish(outputErrors.pipe(args.output_errors)));
    }

    readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true}))
        .pipe(new Stream.Transform({
            objectMode: true,
            transform(ex, encoding, callback) {
                try {
                    let requoted_programs = [];
                    let requoted_sentences = [];
                    for (const program of ex.target_code) {
                        const [newSentence, newProgram] =
                            requoteSentence(ex.id, ex.context, ex.preprocessed, program, args.mode,
                                args.requote_numbers, args.handle_heuristics, args.param_locale);
                        requoted_programs.push(newProgram);
                        requoted_sentences.push(newSentence);
                    }
                    ex.preprocessed = requoted_sentences[0];
                    ex.target_code = requoted_programs;
                    ex.is_ok = true;

                    this.push(ex);
                    callback();
                } catch(e) {
                    console.error('**************');
                    console.error('Failed to requote');
                    console.error(ex.id);
                    console.error(ex.preprocessed);
                    console.error(ex.target_code);
                    console.error('**************');
                    ex.is_ok = false;
                    if (args.skip_errors) {
                        this.push(ex);
                        callback();
                    } else {
                        callback(e);
                    }
                }
            },

            flush(callback) {
                process.nextTick(callback);
            }
        }))
        .pipe(new ConditionalDatasetSplitter({
            output: output,
            outputErrors: outputErrors
        }));

    await Promise.all(promises);
}

export {
    requoteSentence
};
