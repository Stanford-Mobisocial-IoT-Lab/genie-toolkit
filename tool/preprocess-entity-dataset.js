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
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";

const fs = require('fs');
const util = require('util');
const assert = require('assert');
const I18N = require('../lib/i18n');

class EntityPreprocessor {
    constructor(options) {
        this._locale = options.locale;
        this._tokenizer = I18N.get(options.locale).getTokenizer();
    }

    async process(fins, fout) {
        const values = [];
        for (const fin of fins) {
            let input = JSON.parse(await util.promisify(fs.readFile)(fin), {encoding: 'utf8'});
            if ('data' in input)
                input = input.data;
            assert(Array.isArray(input));
            for (const entity of input) {
                values.push({
                    value: entity.value,
                    name: entity.name,
                    canonical: this._tokenizer.tokenize(entity.name).tokens.join(' ')
                });
            }
        }

        await util.promisify(fs.writeFile)(fout, JSON.stringify({
            result: 'ok', data: values
        }, undefined, 2), { encoding: 'utf8' });
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('preprocess-entity-dataset', {
            add_help: true,
            description: "Preprocess (tokenize) an entity value dataset."
        });
        parser.add_argument('-l', '--locale', {
            required: false,
            default: 'en-US',
            help: `BGP 47 locale tag of the language to use for tokenization (defaults to 'en-US', English)`
        });
        parser.add_argument('-o', '--output', {
            required: true,
            help: `Output JSON file for entity values`
        });
        parser.add_argument('input_file', {
            nargs: '+',
            help: 'Input JSON files with an array of entities, with name and value fields'
        });
    },

    async execute(args) {
        const preprocessor = new EntityPreprocessor(args);
        await preprocessor.process(args.input_file, args.output);
    },
};
