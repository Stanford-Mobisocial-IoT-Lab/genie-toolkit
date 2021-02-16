"use strict";


const fs = require('fs');
const os = require('os');
const _ = require('lodash');
const util = require('util');
const path = require('path');
const assert = require('assert');

const ThingTalk = require('thingtalk');

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

class CsqaTranslater {
    constructor(options) {
        this._domains = options.domains;
        this._canonicals = options.canonicals;
        this._input_dir = options.inputDir;
        this._output_dir = options.outputDir;
        this._dataset = options.dataset;
        this._instances;
        this._propertyLabels;
        this._entityLabels;
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

    /**
     * A15: set->{e} subset where entity e in set and belong to entity type tp
     */
    async _set(parsed, lf, idx, canonical) {
        assert(!Array.isArray(lf[idx + 1])); // assume [{}, e]
        assert(_.isEqual(parsed, {})); // assume base case

        // 'e' indicates entity and does not filter anything.
        if (lf[idx+1] !== 'e') {
            parsed.filter = [{ 
                property: this._instances.has(lf[idx+1])? 'id':undefined, 
                values: lf[idx+1]
            }];
        }
        parsed.table = `@org.wikidata.${canonical}()`;
        parsed.type = 'set';
        parsed.op = 'set';
        lf.splice(idx + 1, 1);
    }

    /**
     * A4: set->find(set,r) set of entities with a predicate p edge to entity e
     */
    async _find(parsed, lf, idx, canonical) {
        assert(!Array.isArray(lf[idx + 2]));

        Object.assign(parsed, await this._parseLf(lf[idx + 1], canonical));
        assert(parsed.table);
        assert(parsed.filter);
        assert(parsed.type === 'set');

        parsed.projection = [lf[idx + 2]];
        if (!parsed.filter[parsed.filter.length - 1].property) {
            parsed.filter[parsed.filter.length - 1].property = [lf[idx + 2]];
        }
        parsed.op = 'find';
        lf.splice(idx + 1, 2);
    }

    /**
     * A5: num->count(set)
     * A13: set->argmax(set, r) 
     * A14: set->argmin(set, r) subset of set linking to most entities with relation r
     */
    async _count(parsed, lf, idx, canonical, op) {
        assert(['count', 'max', 'min'].includes(op));
        Object.assign(parsed, await this._parseLf(lf[idx + 1], canonical));
        assert(parsed.table);
        assert(parsed.filter);
        assert(parsed.type === 'set');
        assert(parsed.projection);

        parsed.op = op;
        // If count, we just need to count number of tuples        
        if (op === 'count') {
            parsed.type = 'num';
        } else {
            assert(set.projection.length === 1);
            for (const filter of parsed.filter) {
                if (filter['property'] === parsed.projection[0]) {
                    filter.op = op;
                    break;
                }
            }
        }
        lf.splice(idx + 1, 1);
    }

    /**
     * A26:('Tuple_Count',('traverse','Count','Tuple')) 
     */
    async _traverse(parsed, lf, idx, canonical) {
        assert(lf[idx + 1] === 'Count');

        Object.assign(parsed, await this._parseLf(lf[idx + 2], canonical));
        assert(parsed.table);
        assert(parsed.filter);
        assert(parsed.type === 'set');

        parsed.op = 'traverse';
        lf.splice(idx + 1, 2);
    }

    // A27: ('Tuple',('Pre_Type','r','Type','Type'))
    // A28: ('Tuple',('Reverse_pre_Type','r','Type','Type')), 
    async _pretype(parsed, lf, idx, canonical, reverse) {
        assert(!Array.isArray(lf[idx + 1]));
        assert(!Array.isArray(lf[idx + 2]));
        assert(!Array.isArray(lf[idx + 3]));
        assert(_.isEqual(parsed, {})); // assume base case

        parsed.filter = [{ 
            property: lf[idx + 1],
            values: reverse ? lf[idx + 2] : lf[idx + 3]
        }];
        parsed.table = `@org.wikidata.${canonical}()`;
        parsed.projection = [lf[idx + 1]];
        parsed.type = 'set';
        parsed.op = reverse ? 'reverse_pretype' : 'pretype';
        lf.splice(idx + 1, 3);
    }

    /**
     * A6: bool->in(e, set), whether e is in set
     */
    async _in(parsed, lf, idx, canonical) {
        assert(!Array.isArray(lf[idx + 1]));

        Object.assign(parsed, await this._parseLf(lf[idx+2], canonical));
        assert(parsed.table);
        assert(parsed.filter);
        assert(parsed.type === 'set');
        assert(parsed.projection && set.projection.length === 1);

        parsed.op = 'in';
        parsed.type = 'bool';
        parsed.filter.push('inter');
        parsed.filter.push({
            property: parsed.projection[0], 
            values: lf[idx + 1]
        });
        lf.splice(idx + 1, 2);
    }

    /**
     * A22: set->find(set,reverse(r))
     */
    async _find_reverse(parsed, lf, idx, canonical) {
        assert(!Array.isArray(lf[idx+2]));

        Object.assign(parsed, await this._parseLf(lf[idx+1], canonical));
        assert(parsed.table);
        assert(parsed.filter);
        assert(parsed.type === 'set');
        assert(!parsed.projection);

        parsed.projection = [lf[idx + 2]];
        if (!parsed.filter[parsed.filter.length - 1].property) {
            parsed.filter[parsed.filter.length - 1].property = [lf[idx + 2]];
        }
        parsed.op = 'find_reverse';
        lf.splice(idx + 1, 2);
    }

    /**
     * A23: set->filter(tp, set), subset where entity e in set and belong to entity type tp
     * Ignoring type constraints thingtalk does not support
     */
    async _filter(parsed, lf, idx, canonical) {
        assert(!Array.isArray(lf[idx + 1]));

        Object.assign(parsed, await this._parseLf(lf[idx + 2], canonical));
        assert(parsed.table);
        assert(parsed.filter);
        assert(parsed.type === 'set');
        assert(parsed.projection);

        lf.splice(idx + 1, 2);
    }

    /**
     * A10: set->larger(set, r, num), subset of set linking to more than num entities with relation r
     * A11: set->less(set, r, num), subset of set linking to less than num with relation r
     * A12: set->equal(set, r, num), subset of set linking to num entities with relation r
     */
    async _compare(parsed, lf, idx, canonical, op) {
        const num = await this._parseLf(lf[idx + 1], canonical);
        Object.assign(parsed, await this._parseLf(lf[idx + 2], canonical));
        assert(num.op == 'count');
        assert(num.type === 'num');
        assert(num.projection);
        assert(parsed.op == 'traverse');
        assert(parsed.type === 'set');
        assert(num.table === parsed.table);
        
        const set = JSON.parse(JSON.stringify(parsed));
        set.op = 'count'
        set.type = 'num'
        parsed.filter.push('inter');
        parsed.filter.push({
            num: num,
            set: set,
            op: op
        });
        parsed.op = op;
        lf.splice(idx + 1, 2);
    }

    /**
     * A7: set->union(set1,set2), union of set1 and set2
     * A8: set->inter(set1, set2, intersection of set1 and set2
     * A9: set->diff(set1, set2) instances included in set1 but not included in set2
     */
    async _merge_set(parsed, lf, idx, canonical, op) {
        const set1 = await this._parseLf(lf[idx+1], canonical);
        const set2 = await this._parseLf(lf[idx+2], canonical);
        assert(set1.table === set2.table);
        assert(set1.type === 'set');
        assert(set2.type === 'set');
        assert(set1.filter); 

        Object.assign(parsed, set1);
        if (set1.projection && set2.projection) {
            parsed.projection = Array.from(new Set(set1.projection.concat(set2.projection)));
        } else if (set2.projection && op !== 'diff') {
            parsed.projection = set2.projection;
        }
        parsed.op = op;
        lf.splice(idx + 1, 2);
        const property = set1.filter[set1.filter.length - 1].property;
        assert(property);

        // Logical form often tries to perform union/inter/diff on exact same set.
        // It is either meaningless or incorrect. Hence returing in such case
        // without applying second filter.
        if (_.isEqual(set1.filter, set2.filter)) return;

        if (property && set2.filter && set2.filter[set2.filter.length - 1].property) {
            if (op === 'diff') {
                op = 'inter';
                // De Morgan's laws
                for (let i = 0; i < set2.filter.length; i++) {
                    switch(set2.filter[i]) {
                        case('union'):
                            set2.filter[i] = 'inter';
                            break;
                        case('inter'):
                            set2.filter[i] = 'union';
                            break;
                        default:
                            set2.filter[i].negate = true;
                    }
                }
            }
            parsed.filter = [
                set1.filter.length === 1 ? set1.filter[0] : set1.filter, 
                op, 
                set2.filter.length === 1 ? set2.filter[0] : set2.filter, 
            ];
        } else if (set2.filter  && set2.filter[set2.filter.length - 1].property && op !== 'union') {
            assert(false); // Assuming no such case.
        }
    }

    async _parseLf(lf, canonical) {
        assert(Array.isArray(lf))

        let idx = 0;
        const parsed = {};
        while (lf.length > idx) {
            switch(lf[idx]) {
                case 'find': // A4: set->find(set, r) 
                    await this._find(parsed, lf, idx, canonical);
                    break;
                case 'count': // A5: num->count(set)
                    await this._count(parsed, lf, idx, canonical, 'count');
                    break;    
                case 'in': // A6: bool->in(e, set)
                    await this._in(parsed, lf, idx, canonical);
                    break;
                case 'union': // A7: set->union(set1, set2)
                    await this._merge_set(parsed, lf, idx, canonical, 'union');
                    break;
                case 'inter': // A8: set->inter(set1, set2
                    await this._merge_set(parsed, lf, idx, canonical, 'inter');
                    break;    
                case 'diff': // A9: set->diff(set1, set2) 
                    await this._merge_set(parsed, lf, idx, canonical, 'diff');
                    break;
                case '>': // A10: set->larger(set, r, num)
                    await this._compare(parsed, lf, idx, canonical, '>');
                    break;         
                case '<': // A11: set->less(set, r, num) 
                    await this._compare(parsed, lf, idx, canonical, '<');
                    break;
                case '=': // A12: set->equal(set, r, num)
                    await this._compare(parsed, lf, idx, canonical, '==');
                    break;
                case 'argmax': // A13: set->argmax(set, r) 
                    await this._count(parsed, lf, idx, canonical, 'max');
                    break;
                case 'argmin': // A14: set->argmin(set, r) 
                    await this._count(parsed, lf, idx, canonical, 'min');
                    break;
                case '{}': // A15: set->{e}
                    await this._set(parsed, lf, idx, canonical);
                    break;
                case 'find_reverse': // A22: set->find(set,reverse(r))
                    await this._find_reverse(parsed, lf, idx, canonical);
                    break;  
                case 'filter': // A23: set->filter(tp, set)
                    await this._filter(parsed, lf, idx, canonical);
                    break;   
                case 'traverse': // A26: ('Tuple_Count',('traverse','Count','Tuple'))
                    await this._traverse(parsed, lf, idx, canonical);
                    break;
                case 'Pre_Type': // A27: ('Tuple',('Pre_Type','r','Type','Type'))
                    await this._pretype(parsed, lf, idx, canonical, false);
                    break;
                case 'Reverse_pre_Type': // A28: ('Tuple',('Reverse_pre_Type','r','Type','Type'))
                    await this._pretype(parsed, lf, idx, canonical, true);
                    break;
                default:
                    console.log(lf);
                    throw new Error(`Unknown grammer: ${lf[idx]}`);
            }
            idx++;
        }
        return parsed;
    }

    async _buildFilter(filters) {
        let query = '(';
        for (const filter of filters) {
            if(Array.isArray(filter)) {
                query += `${await this._buildFilter(filter)}`;
            } else if(typeof filter === "object") {
                if (filter.property && filter.values) {
                    const property = filter.property === 'id' ? 'id' : argnameFromLabel(this._propertyLabels[filter.property]);
                    const values = this._entityLabels[filter.values];
                    if (values) {
                        query += `${property} ${filter.negate ?'!=':'=='} "${values.toLowerCase()}"`;
                    } else {
                        const label = await getItemLabel(filter.values);
                        if (label) {
                            query += `${property} ${filter.negate ?'!=':'=='} "${label.toLowerCase()}"`;
                            this._entityLabels[filter.values] = label;
                        } else {
                            // Since we won't get correct answer, ignore this for now.
                            console.log(`Not found: ${filter.values}`);
                        }
                    }
                } else if (filter.num  && filter.op && filter.set) { // Incomplete as compare func not yet implemented.
                    assert(filter.num.op === 'count');
                    assert(filter.set.op === 'count');
                    query += `(${await this._buildThingTalk(filter.set)}) ${filter.op} (${await this._buildThingTalk(filter.num)})`
                } else {
                    console.log(filter);
                    throw Error(`Unknown filter:`);
                }
            } else {
                switch(filter) {
                    case('union'):
                        query += ' || ';
                        break;
                    case('inter'):
                        query += ' && ';
                        break;
                    default:
                        throw Error(`Unknown operation: ${filter}`);
                }
            }
        }
        query += ')';
        return query;
    }

    async _buildProjection(projection) {
        const query = [];
        for (const item of projection) {
            query.push(argnameFromLabel(this._propertyLabels[item]));
        }
        return `[${query.join(',')}]`;
    }


    async _buildThingTalk(lf) {
        const projection = await this._buildProjection(lf.projection);
        const filter = await this._buildFilter(lf.filter);
        let query = `${projection} of ${lf.table} filter ${filter}`;
        if (lf.op === 'count') {
            assert(lf.type === 'num');
            query = `count(${query})`;
        }
        if(lf.op === 'in') {
            assert(lf.type === 'bool');
            query = `count(${query})`;
        }
        return query;
    }

    async _conveter(canonical) {
        // Skipping in, larger, less, equal, argmin and argmax. Not yet supported in thingtalk.
        // Hence correspodning helper functions are incomplete.
        const unsupported = ['A6', 'A10', 'A11', 'A12', 'A13', 'A14'];
        const dialogs = JSON.parse((await this. _readSync(fs.readFile, this._pathes[0])));
        
        let idx = 0;
        const annotated = [];
        const skipped = [];
        const test = [];
        for (const dialog of dialogs) {
            const user = dialog.user;
            const system = dialog.system;
            console.log(idx + ':' + dialog.file.split('.')[0] + ':' + dialog.turn);
            console.log(user.utterance);
            console.log(system.utterance);
            console.log(system.active_set);

            const alltk = new Set();
            for (const lf of system.true_lf) {
                const sketch = [[],[]];
                await this._splitLf(lf[1], sketch);
                if (!(sketch[1].some(r => unsupported.includes(r)))) { 
                    const parsed = await this._parseLf(lf[0], canonical);
                    const thingtalk = `${await this._buildThingTalk(parsed)};`;
                    alltk.add(thingtalk);
                }
            }
            if (alltk.size === 0) {
                skipped.push(dialog);
            } else {
                dialog.alltk = Array.from(alltk);
                // Just use last one for now.
                test.push(`${test.length + 1}\t${user.utterance.toLowerCase()}\t${dialog.alltk[alltk.size - 1]}`);
                annotated.push(dialog);
                console.log(dialog.alltk);
            }
            console.log(`-------------------------------------`);
            idx++;
        }
        console.log(`${annotated.length} sentences correctly anntated in ${canonical}`);
        console.log(`${skipped.length} sentences skipped in ${canonical}`);
        await util.promisify(fs.writeFile)(
            path.join(this._output_dir, canonical, 'eval-synthetic', `annotated.tsv`), test.join('\n'), 
            { encoding: 'utf8' });
    }

    async run() {
        this._propertyLabels = JSON.parse(await this. _readSync(fs.readFile, path.join(this._output_dir, 'datadir', 'filtered_property_wikidata4.json')));

        for (const idx in this._domains) {
            this._pathes = [
                path.join(this._output_dir, this._canonicals[idx], `${this._dataset}_unfiltered.json`)
            ];
            this._entityLabels = JSON.parse(await this. _readSync(fs.readFile, path.join(this._output_dir, this._canonicals[idx], 'property_item_values.json')));
            this._instances = new Set((await this. _readSync(fs.readFile, path.join(this._output_dir, this._canonicals[idx], 'instances.txt'))).split(','));

            // Get list of sample questions and answers
            if (!fs.existsSync(this._pathes[0])) {
                await this._filterDomainQAPairs(this._canonicals[idx]);
            }
            await this._conveter(this._canonicals[idx]);
        }
    }
}    

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-translate-csqa', {
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
        const csqaTranslater = new CsqaTranslater({
            domains: domains,
            canonicals: canonicals,
            inputDir: args.input,
            outputDir: args.output,
            dataset: args.dataset
        });
        csqaTranslater.run();
    }
};