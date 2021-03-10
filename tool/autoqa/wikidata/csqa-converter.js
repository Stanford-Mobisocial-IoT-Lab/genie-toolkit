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
// Author: Naoki Yamamura <yamamura@cs.stanford.edu>
"use strict";


const fs = require('fs');
const os = require('os');
const _ = require('lodash');
const util = require('util');
const path = require('path');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Tp  = require('thingpedia');
const Ast = ThingTalk.Ast;
const I18N = require('../../../lib/i18n');
const tokenizer = I18N.get('en-US' ).getTokenizer();

import { serializePrediction } from '../../../lib/utils/thingtalk';
import {
    getItemLabel,
    argnameFromLabel,
} from './utils';
import { makeDummyEntities } from "../../../lib/utils/entity-utils";

const QUESTION_TYPES = new Set(
    ['Simple Question (Direct)',
    'Verification (Boolean) (All)',
    'Logical Reasoning (All)',
    'Quantitative Reasoning (All)',
    'Quantitative Reasoning (Count) (All)',
    'Comparative Reasoning (All)',
    'Comparative Reasoning (Count) (All)']);

class CsqaConverter {
    constructor(options) {
        this._domains = options.domains;
        this._canonicals = options.canonicals;
        this._input_dir = options.inputDir;
        this._output_dir = options.outputDir;
        this._dataset = options.dataset;
        this._instances = options.instances;
        this._propertyLabels = options.propertyLabels;
        this._entityLabels = options.entityLabels;
        this._pathes;
    }

    async _readSync(func, dir) {
        return util.promisify(func)(dir, { encoding: 'utf8' });
    }

    async _filterDomainQAPairs(canonical) {
        const basePath = path.join(this._input_dir, this._dataset)
        let cnt = 0;
        const qaPairs = [];
        for (const dir of (await this. _readSync(fs.readdir, basePath))) {
            for (const file of (await this. _readSync(fs.readdir, path.join(basePath, dir)))) {
                const dialog = JSON.parse((await this. _readSync(fs.readFile, path.join(basePath, dir, file))));
                let userTurn;
                for (const turn in dialog) {
                    const speaker = dialog[turn].speaker;
                    if (speaker === 'USER') {
                        userTurn = dialog[turn];
                    } else {
                        let found = false;
                        for (let active of dialog[turn].active_set) {
                            active = active.replace(/[^0-9PQ,|]/g, '').split(',');
                            const entities = active[0].split('|').concat(active[2].split('|'))
                            for (const entity of entities) {
                                if (this._instances.has(entity) &&
                                    QUESTION_TYPES.has(userTurn['question-type']) &&
                                    userTurn.description &&
                                    !userTurn.description.toLowerCase().includes('indirect') &&
                                    !userTurn.description.toLowerCase().includes('incomplete')) {
                                    qaPairs.push({
                                        file: file,
                                        turn: turn - 1, // count from start of the turn (i.e. user turn)
                                        user: userTurn,
                                        system: dialog[turn],
                                    });
                                    cnt++;
                                    found = true;
                                    break; // one entity set is sufficient for positive case.
                                }
                            }
                            if (found) break; // break +1 outer loop as well.
                        }
                    }
                }
            }
        }
        console.log(`${cnt} QA pairs found for ${canonical} domain.`);
        await util.promisify(fs.writeFile)(
            this._pathes[0], JSON.stringify(qaPairs, undefined, 2), 
            { encoding: 'utf8' });
    }

    async getArgName(qid, pid) {
        return  this._instances.has(qid) ? 'id' : argnameFromLabel(this._propertyLabels[pid]);
    }

    async getArgValue(qid) {
        let value = this._entityLabels[qid];
        if (!value) {
            value = await getItemLabel(qid);
            if (value) {
                this._entityLabels[qid] = value;
            } else {
                // Since we won't get correct answer, ignore this for now.
                console.log(`Not found: ${qid}`);
                return;
            }
        }
        return value.toLowerCase();
    }

    async getTable(canonical) {
        const selector = new Ast.DeviceSelector(null, 'org.wikidata', null, null);
        return (new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, canonical, [], null), null));
    }

    async getSingleFilter(activeSet, negate) {
        const param = await this.getArgName(activeSet[0], activeSet[1]);
        const arg = await this.getArgValue(activeSet[0])
        if (!arg) return;

        const ttValue = new Ast.Value.String(arg);
        const exp = new Ast.BooleanExpression.Atom(null, param, '=~', ttValue);
        return negate ? new Ast.BooleanExpression.Not(null, exp) : exp;
    }

    async getMultiFilter(activeSet, negate) {
        const filter1 = await this.getSingleFilter(activeSet.slice(0, 3));
        const filter2 = await this.getSingleFilter(activeSet.slice(3), negate);
        if (!filter1 || !filter2) return;
        return [filter1, filter2];
    }

    // ques_type_id=1
    async simpleQuestion(canonical, activeSet) {
        const exp = await this.getSingleFilter(activeSet);
        if (!exp) return;

        const invocationTable = await this.getTable(canonical);
        const filter = new Ast.BooleanExpression.And(null, [exp]);
        const filterTable = new Ast.FilterExpression(null, invocationTable, filter, null);
        // Return projected table.
        return (new Ast.ProjectionExpression(null, filterTable, [(await this.getArgName(activeSet[2], activeSet[1]))], [], []));
    }

    // ques_type_id=2
    async secondaryQuestion	(canonical, activeSet, secQuesType) {
        switch(secQuesType) {
            case 1: // Subject based question
                return this.simpleQuestion(canonical, activeSet);
            case 2: // Object based question
                return this.simpleQuestion(canonical, activeSet);
            default:
                throw new Error(`Unknown sec_ques_type: ${secQuesType}`);    
        }

    }

    // ques_type_id=4
    async setBasedQuestion(canonical, activeSet, setOpChoice) {
        const invocationTable = await this.getTable(canonical);
        let filter;
        switch(setOpChoice) {
            case 1: // OR
                filter = await this.getMultiFilter(activeSet);
                if (!filter) return;
                filter = new Ast.BooleanExpression.Or(null, filter);
                break;
            case 2: // AND
                filter = await this.getMultiFilter(activeSet);
                if (!filter) return;
                filter = new Ast.BooleanExpression.And(null, filter);
                break;
            case 3: // Difference
                filter = await this.getMultiFilter(activeSet, true);
                if (!filter) return;
                filter = new Ast.BooleanExpression.And(null, filter);
                break;
            default:
                throw new Error(`Unknown set_op_choice: ${setOpChoice}`);
        }

        const filterTable = new Ast.FilterExpression(null, invocationTable, filter, null);
        let param;
        if (activeSet[1] === activeSet[4]) {
            param = [(await this.getArgName(activeSet[2], activeSet[1]))];
        } else {
            param = [(await this.getArgName(activeSet[2], activeSet[1])), (await this.getArgName(activeSet[5], activeSet[4]))];
        }
        // Return projected table.
        return (new Ast.ProjectionExpression(null, filterTable, param, [], []));
    }

    // ques_type_id=7
    async quantitativeQuestionsSingleEntity(canonical, activeSet, countQuesSubType) {
        switch(countQuesSubType) {
            case 1: // Quantitative (count) single entity
                const exp = await this.simpleQuestion(canonical, activeSet);
                if (!exp) return;
                return new Ast.AggregationExpression(null, exp, '*', 'count', null);
            case 2: // Quantitative (min/max) single entity
                return; // not supprted in thingtalk.
            default:
                throw new Error(`Unknown count_ques_sub_type: ${countQuesSubType}`);    
        }
    }

    // ques_type_id=8
    async quantitativeQuestionsMultiEntity(canonical, activeSet, countQuesSubType, setOpChoice) {
        switch(countQuesSubType) {
            case 1: // Quantitative with Logical Operators
                return new Ast.AggregationExpression(null, await this.setBasedQuestion(canonical, activeSet, setOpChoice), '*', 'count', null);
            case 2: // Quantitative (count) multiple entity
                if (activeSet[1] === activeSet[4]) {
                    const exp = await this.simpleQuestion(canonical, activeSet);
                    if (!exp) return;
                    return new Ast.AggregationExpression(null, exp, '*', 'count', null);
                } else {
                    return new Ast.AggregationExpression(null, await this.setBasedQuestion(canonical, activeSet, setOpChoice), '*', 'count', null);
                }
            default:
                throw new Error(`Unknown count_ques_sub_type: ${countQuesSubType}`);    
        }
    }

    async csqaToThingTalk(canonical, dialog) {
        const user = dialog.user;
        const system = dialog.system;
            
        let activeSet = [];
        for (let active of system.active_set) {
            // There is no info if the question is subject or object based in CSQA json
            // except for ques_type_id 2. So we check that ourselves.
            if (!user.sec_ques_type) {
                const type = active.replace(/[^0-9PQc,|]/g, '').split(',');
                user.sec_ques_type = type[0].startsWith('c') ? 2:1;
            }
            active = active.replace(/[^0-9PQ,|]/g, '').split(',');
            if (user.sec_ques_type === 2) {
                active = active.reverse();
            }
            activeSet = activeSet.concat(active);
        }

        let tk;
        switch(user.ques_type_id) {
            case 1: // Simple Question (subject-based)
                tk = await this.simpleQuestion(canonical, activeSet);
                break;
            case 2: // Secondary question
                tk = await this.secondaryQuestion(canonical, activeSet, user.sec_ques_type);
                break;
            case 3: // Clarification (for secondary) question
                break;
            case 4: // Set-based question
                tk = await this.setBasedQuestion(canonical, activeSet, user.set_op_choice);
            case 5: // Boolean (Factual Verification) question
                break; // Not supported by thingtalk
            case 6: // Incomplete question (for secondary)
                break;
            case 7: // Comparative and Quantitative questions (involving single entity)
                tk = await this.quantitativeQuestionsSingleEntity(canonical, activeSet, user.count_ques_sub_type);
                break;
            case 8: // Comparative and Quantitative questions (involving multiple(2) entities)
                assert(user.set_op);
                const op = user.set_op === 2 ? 1:2; // Somehow set op is reverse of question type 4
                tk = await this.quantitativeQuestionsMultiEntity(canonical, activeSet, user.count_ques_sub_type, op);
                break;
            default:
                throw new Error(`Unknown ques_type_id: ${user.ques_type_id}`);
        }
        return tk;
    }

    async _conveter(canonical, dialogs) {
        const dataset = [];
        const annotated = [];
        const skipped = [];
        const error = [];
        for (const dialog of dialogs) {
            const user = dialog.user;
            const tk = await this.csqaToThingTalk(canonical, dialog);

            if (tk) {
                try {
                    const preprocessed = tokenizer.tokenize(user.utterance).join(' ');
                    const entities = makeDummyEntities(preprocessed);
                    const thingtalk = serializePrediction(tk, preprocessed, entities, { locale: 'en-US' }).join(' ');
                    dialog.tk = thingtalk;
                    dataset.push(`${dataset.length + 1}\t${preprocessed}\t${thingtalk}`);
                    annotated.push(dialog);
                } catch (e) {
                    // Mostly non-English alphabet
                    error.push(dialog);
                }
            } else {
                skipped.push(dialog);
            }
        }
        console.log(`${annotated.length} sentences anntated in ${canonical}`);
        console.log(`${skipped.length} sentences skipped in ${canonical}`);
        console.log(`${error.length} sentences thrown error in ${canonical}`);
        await util.promisify(fs.writeFile)(
            path.join(this._output_dir, canonical, `${this._dataset}.tsv`), dataset.join('\n'), 
            { encoding: 'utf8' });
    }

    async run() {
        for (const idx in this._domains) {
            this._pathes = [
                path.join(this._output_dir, this._canonicals[idx], `${this._dataset}.json`),
                path.join(this._output_dir, this._canonicals[idx], 'property_item_values.json'),
                path.join(this._output_dir, this._canonicals[idx], 'instances.txt'),
                path.join(this._output_dir, 'datadir', 'filtered_property_wikidata4.json')
            ];
            assert(fs.existsSync(this._pathes[2]));
            assert(fs.existsSync(this._pathes[3]));
            this._instances = new Set((await this. _readSync(fs.readFile, this._pathes[2])).split(','));
            this._propertyLabels = JSON.parse(await this. _readSync(fs.readFile, this._pathes[3]));

            if (fs.existsSync(this._pathes[1])) {
                this._entityLabels = JSON.parse(await this. _readSync(fs.readFile, this._pathes[1]));
            }
            if (!fs.existsSync(this._pathes[0])) {
                // Get list of sample questions and answers
                await this._filterDomainQAPairs(this._canonicals[idx]);
            }

            const dialogs = JSON.parse((await this. _readSync(fs.readFile, this._pathes[0])));
            await this._conveter(this._canonicals[idx], dialogs);
        }
    }
}    

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-convert-csqa', {
            add_help: true,
            description: "Generate parameter-datasets.tsv from processed wikidata dump. "
        });
        parser.add_argument('-o', '--output', {
            required: true,
            help: ''
        });
        parser.add_argument('-i', '--input', {
            required: true,
            help: ''
        });
        parser.add_argument('--domains', {
            required: true,
            help: 'domains (by item id) to process data, split by comma (no space)'
        });
        parser.add_argument('--dataset', {
            required: true,
            help: 'one of valid, test, or train.'
        });
        parser.add_argument('--domain-canonicals', {
            required: true,
            help: 'the canonical form for the given domains, used as the query names, split by comma (no space);'
        });
    },

    async execute(args) {
        const domains = args.domains.split(',');
        const canonicals = args.domain_canonicals.split(',');
        const csqaConverter = new CsqaConverter({
            domains: domains,
            canonicals: canonicals,
            inputDir: args.input,
            outputDir: args.output,
            dataset: args.dataset
        });
        csqaConverter.run();
    },
    CsqaConverter
};
