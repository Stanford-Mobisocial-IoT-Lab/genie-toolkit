"use strict";

const fs = require('fs');
const fsExtra = require('fs-extra')
const assert = require('assert');
const util = require('util');
const path = require('path');
const os = require('os');

const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const I18N = require('../../../lib/i18n');

const {
    getItemLabel,
    getPropertyLabel,
    getType,
    getElementType,
    argnameFromLabel,
    loadSchemaOrgManifest
} = require('./utils');

class ParamDatasetGenerator {
    constructor(options) {
        this._locale = options.locale;
        this._domains = options.domains;
        this._canonicals = options.canonicals;
        this._input_dir = options.inputDir;
        this._output_dir = options.outputDir;
        this._maxValueLength = options.maxValueLength;
        this._tokenizer = I18N.get(options.locale).getTokenizer();
        this._properties = {};
        this._pathes = {};
        this._schemaorgManifest = options.schemaorgManifest;
        this._schemaorgProperties = {};
        for (const domain of this._domains) {
            this._properties[domain] = new Set();
            this._pathes[domain] = new Set();
        }
    }

    async _readSync(func, dir) {
        return util.promisify(func)(dir, { encoding: 'utf8' });
    }

    async _processData(domain, domainLabel, table, outputDir, isEntity, canonical) {
        const inputDir = path.join(this._input_dir, domain, table);
        const inputsPath = await this. _readSync(fs.readdir, inputDir);
        
        for (const inputPath of inputsPath) {
            const property = inputPath.split('.')[0];
            const label = await getPropertyLabel(property);
            const type = await getType(domain, domainLabel, property, label, this._schemaorgProperties);
            let fileId = `org.wikidata:${(await argnameFromLabel(label))}`;            
            if (type) {
                const elemType = getElementType(type);
            
                // If not entity or String/Location/Currency type save property and skip.
                if (!elemType.isString && !elemType.isEntity && !elemType.isLocation && !elemType.isCurrency) {
                    this._properties[domain].add(property);
                    continue;
                }

                if (elemType.isEntity) {
                    const typeStr = type.toString();
                    fileId = `${typeStr.substring(typeStr.lastIndexOf("Entity(") + 7, typeStr.indexOf(")"))}`;
                    isEntity = true;
                }  else if (elemType.isLocation) {
                    fileId = 'tt:location';
                    isEntity = false;
                }  else if (elemType.isCurrency) {
                    fileId = 'tt:currency_code';
                    isEntity = false;
                }

                if (elemType.isString) {
                    isEntity = false;
                }
            }
            
            const outputPath = path.join(outputDir, `${fileId}.${isEntity?'json':'tsv'}`);
            const inputs = (await this. _readSync(fs.readFile, path.join(inputDir, inputPath))).split(os.EOL);
            const data = [];
            for (const input of inputs) {
                // Last item in array is empty
                if (input === '') 
                    continue;
                const item = JSON.parse(input);

                if (isEntity) {
                    // Some entity does not have value. Skip.
                    if (!('value' in item) || item.value.includes('æ'))
                        continue;

                    const entity = {
                        value: item.value,
                        name: item.name
                    };
                    const tokens = this._tokenizer.tokenize(item.value).tokens;

                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    entity.canonical = tokens.join(' ');
                    if (this._maxValueLength >= 0 && entity.canonical.length > this._maxValueLength)
                        continue;

                    data.push(entity);
                } else {
                    if (!('value' in item) || item.value.includes('æ'))
                        continue;
                    
                    const value = item.value;
                    const tokens = this._tokenizer.tokenize(value).tokens;
                    const weight = 1;
                    
                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    const tokenizedString = tokens.join(' ');
                    if (this._maxValueLength >= 0 && tokenizedString.length > this._maxValueLength)
                        continue;

                    data.push(`${value}\t${tokenizedString}\t${weight}`);
                }
            }

            // Dump propety data
            if (data.length !== 0) {
                this._properties[domain].add(property);
                let dataPath;          
                if (!isEntity) {
                    dataPath = `string\t${this._locale}\t${fileId}\t${path.relative(path.join(this._output_dir, canonical), outputPath)}`;
                    let outData = data.join(os.EOL).concat(os.EOL);
                    await util.promisify(fs.appendFile)(outputPath, outData, { encoding: 'utf8' });
                } else {
                    let outData = { result: 'ok', data };
                    dataPath = `entity\t${this._locale}\t${fileId}\t${path.relative(path.join(this._output_dir, canonical), outputPath)}`;
                    if (this._pathes[domain].has(dataPath)) {
                        outData = JSON.parse(await this. _readSync(fs.readFile, outputPath));
                        outData['data'] = outData['data'].concat(data);
                    }
                    await util.promisify(fs.writeFile)(outputPath, JSON.stringify(outData, undefined, 2), { encoding: 'utf8' });
                }
                this._pathes[domain].add(dataPath);
            }
        }
    }

    async run() {
        await loadSchemaOrgManifest(this._schemaorgManifest, this._schemaorgProperties);
        for (const idx in this._domains) {
            const outputDir = path.join(this._output_dir, this._canonicals[idx], 'parameter-datasets');
            await util.promisify(fsExtra.emptyDir)(outputDir); // Clean up parameter-datasets
            await util.promisify(fs.mkdir)(outputDir, { recursive: true });
            const domainLabel = await getItemLabel(this._domains[idx]);    
            await Promise.all([
                this._processData(this._domains[idx], domainLabel, 'labeled_entity', outputDir, true, this._canonicals[idx]),
                this._processData(this._domains[idx], domainLabel, 'value', outputDir, false, this._canonicals[idx]),
                this._processData(this._domains[idx], domainLabel, 'external', outputDir, false, this._canonicals[idx])
            ]);
            await util.promisify(fs.writeFile)(path.join(this._output_dir, this._canonicals[idx], 'parameter-datasets.tsv'), 
                Array.from(this._pathes[this._domains[idx]]).join('\n'), { encoding: 'utf8' });
            await util.promisify(fs.writeFile)(path.join(this._output_dir, this._canonicals[idx], 'properties.txt'), 
                Array.from(this._properties[this._domains[idx]]).join(','), { encoding: 'utf8' });
        }
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-preprocess-data', {
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
        parser.add_argument('--locale', {
            required: false,
            default: 'en-US'
        });
        parser.add_argument('--domains', {
            required: true,
            help: 'domains (by item id) to process data, split by comma (no space)'
        });
        parser.add_argument('--domain-canonicals', {
            required: true,
            help: 'the canonical form for the given domains, used as the query names, split by comma (no space);'
        });
        parser.add_argument('--schemaorg-manifest', {
            required: false,
            help: 'Path to manifest.tt for schema.org; used for predict the type of wikidata properties'
        });
        parser.add_argument('--max-value-length', {
            required: false,
            help: ''
        });
    },

    async execute(args) {
        const domains = args.domains.split(',');
        const canonicals = args.domain_canonicals.split(',');
        const paramDatasetGenerator = new ParamDatasetGenerator({
            locale: args.locale,
            domains: domains,
            canonicals: canonicals,
            inputDir: args.input,
            outputDir: args.output,
            schemaorgManifest:args.schemaorg_manifest,
            maxValueLength: args.max_value_length
        });
        paramDatasetGenerator.run();
    }
};