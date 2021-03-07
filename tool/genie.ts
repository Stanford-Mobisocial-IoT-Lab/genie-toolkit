#!/usr/bin/env node
// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

process.on('unhandledRejection', (up) => { throw up; });

import * as argparse from 'argparse';

interface SubCommand {
    initArgparse(parser : argparse.SubParser) : void;
    execute(args : any) : Promise<void>;
}

const subcommands : { [key : string] : SubCommand } = {
    'download-snapshot': require('./download-snapshot'),
    'download-dataset': require('./download-dataset'),
    'sample-constants': require('./sample-constants'),

    'compile-template': require('./compile-template'),
    'generate': require('./generate'),
    'generate-dialogs': require('./generate-dialogs'),
    'dialog-to-contextual': require('./dialog-to-contextual'),
    'simulate-dialogs': require('./simulate-dialogs'),

    'sample': require('./sample'),
    'mturk-make-paraphrase-hits': require('./mturk-make-paraphrase-hits'),
    'mturk-make-validation-hits': require('./mturk-make-validation-hits'),
    'mturk-validate': require('./mturk-validate'),
    'mturk-process-eval-data': require('./mturk-process-eval-data'),

    'augment': require('./augment'),
    'requote': require('./requote'),
    'resample': require('./resample'),
    'split-train-eval': require('./split-train-eval'),
    'typecheck': require('./typecheck'),
    'deduplicate': require('./deduplicate'),
    'measure-training-set': require('./measure-training-set'),
    'compute-training-coverage': require('./compute-training-coverage'),

    'train': require('./train'),
    'predict': require('./predict'),
    'evaluate-server': require('./evaluate-server'),
    'evaluate-file': require('./evaluate-file'),
    'manual-annotate': require('./manual-annotate'),
    'manual-annotate-dialog': require('./manual-annotate-dialog'),
    'interactive-annotate': require('./interactive-annotate'),
    'evaluate-dialog': require('./evaluate-dialog'),
    'server': require('./server'),
    'assistant': require('./assistant'),

    'subsample-thingpedia': require('./subsample-thingpedia'),
    'preprocess-string-dataset': require('./preprocess-string-dataset'),
    'preprocess-entity-dataset': require('./preprocess-entity-dataset'),

    'autoqa-annotation-diff': require('./autoqa/annotation-diff'),

    'schemaorg-process-schema': require('./autoqa/schemaorg/process-schema'),
    'schemaorg-normalize-data': require('./autoqa/schemaorg/normalize-data'),
    'schemaorg-trim-class': require('./autoqa/schemaorg/trim-class'),
    'schemaorg-retrieve-wikidata-labels': require('./autoqa/schemaorg/retrieve-wikidata-labels'),

    'sgd-process-schema': require('./autoqa/sgd/process-schema'),
    'sgd-normalize-data': require('./autoqa/sgd/normalize-data'),

    'wikidata-process-schema': require('./autoqa/wikidata/process-schema'),
    'wikidata-preprocess-data': require('./autoqa/wikidata/preprocess-data'),
    'wikidata-convert-csqa': require('./autoqa/wikidata/csqa-converter'),
    'wikidata-es-import': require('./autoqa/wikidata/es-import'),
    'wikidata-download-data': require('./autoqa/wikidata/download-data'),
    'wikidata-label-retriever': require('./autoqa/wikidata/label-retriever'),
    'wikidata-make-string-datasets': require('./autoqa/wikidata/make-string-datasets'),
    'wikidata-demo': require('./autoqa/wikidata/demo'),

    'auto-annotate': require('./autoqa/auto-annotate'),
    'make-string-datasets': require('./autoqa/make-string-datasets'),

    'auto-annotate-multiwoz': require('./auto-annotate-multiwoz'),
    'extract-predicted-slots': require('./extract-predicted-slots'),
    'analyze-dialogue-annotations': require('./analyze-dialogue-annotations')
};

async function main() {
    const parser = new argparse.ArgumentParser({
        add_help: true,
        description: "A tool to generate natural language semantic parsers for programming languages."
    });

    const subparsers = parser.add_subparsers({
        title: 'Available sub-commands',
        dest: 'subcommand',
        required: true
    } as argparse.SubparserOptions);
    for (const subcommand in subcommands)
        subcommands[subcommand].initArgparse(subparsers);

    const args = parser.parse_args();
    await subcommands[args.subcommand].execute(args);
}
main();
