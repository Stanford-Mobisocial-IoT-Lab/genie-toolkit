"use strict";


const fs = require('fs');
const os = require('os');
const _ = require('lodash');
const util = require('util');
const path = require('path');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

import {
    wikidataQuery,
    getItemLabel,
    argnameFromLabel,
} from './utils';

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
        for (const file of (await this. _readSync(fs.readdir, basePath))) {
            const dialog = JSON.parse((await this. _readSync(fs.readFile, path.join(basePath, file))));
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
                                !userTurn.description.toLowerCase().includes('incomplete')&&
                                dialog[turn].true_lf.length > 0) {
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
        console.log(`${cnt} QA pairs found for ${canonical} domain.`);
        await util.promisify(fs.writeFile)(
            this._pathes[0], JSON.stringify(qaPairs, undefined, 2), 
            { encoding: 'utf8' });
    }

    async _splitLf(lf, sketch) {
        for (const elem of lf) {
            if (Array.isArray(elem)) {
                sketch[0].push(elem[0]); // sketch of lf
                sketch[1].push(elem[1]); // actual lf           
            } else {
                throw Error('Malformed logical form.');
            }
        }
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
                return "";
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
        const ttValue = new Ast.Value.String(await this.getArgValue(activeSet[0]));
        const exp = new Ast.BooleanExpression.Atom(null, param, '=~', ttValue);
        return negate ? new Ast.BooleanExpression.Not(null, exp) : exp;
    }

    async getMultiFilter(activeSet, negate) {
        const filterClauses = [];
        filterClauses.push(await this.getSingleFilter(activeSet.slice(0, 3)));
        filterClauses.push(await this.getSingleFilter(activeSet.slice(3), negate));
        return filterClauses;
    }

    // ques_type_id=1
    async simpleQuestion(canonical, activeSet) {
        const invocationTable = await this.getTable(canonical);
        const filter = new Ast.BooleanExpression.And(null, [(await this.getSingleFilter(activeSet))]);
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
                filter = new Ast.BooleanExpression.Or(null, (await this.getMultiFilter(activeSet)));
                break;
            case 2: // AND
                filter = new Ast.BooleanExpression.And(null, (await this.getMultiFilter(activeSet)));
                break;
            case 3: // Difference
                filter = new Ast.BooleanExpression.And(null, (await this.getMultiFilter(activeSet, true)));
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
                return new Ast.AggregationExpression(null, await this.simpleQuestion(canonical, activeSet), '*', 'count', null);
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
                    return new Ast.AggregationExpression(null, await this.simpleQuestion(canonical, activeSet), '*', 'count', null);
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
        if (tk) {
            const _schemaRetriever = new ThingTalk.SchemaRetriever(
                null,
                null,
                true);
            await ThingTalk.Syntax.parse(`${tk.prettyprint()};`).typecheck(_schemaRetriever).then(
                    (program) => {
                    //convert from ast to sparql
                    let generated = Helper.toSparql(program);
                }
            );
            return tk.prettyprint();
        } 
    }

    async _conveter(canonical, dialogs) {
        const test = [];
        const annotated = [];
        const skipped = [];
        for (const dialog of dialogs) {
            const user = dialog.user;
            const tk = await this.csqaToThingTalk(canonical, dialog);

            if (tk) {
                dialog.tk = tk;
                test.push(`${test.length + 1}\t${user.utterance.toLowerCase()}\t${dialog.tk}`);
                annotated.push(dialog);
            } else {
                skipped.push(dialog);
            }
        }
        console.log(`${annotated.length} sentences correctly anntated in ${canonical}`);
        console.log(`${skipped.length} sentences skipped in ${canonical}`);
        await util.promisify(fs.writeFile)(
            path.join(this._output_dir, canonical, 'eval-synthetic', `annotated.tsv`), test.join('\n'), 
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