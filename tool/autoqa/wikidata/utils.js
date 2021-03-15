// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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

import * as fs from 'fs';
import util from 'util';
import assert from 'assert';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import { cleanEnumValue, snakecase } from '../lib/utils';

import {
    PROPERTY_TYPE_OVERRIDE,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_TYPE_SAME_AS_SUBJECT
} from './manual-annotations';

const URL = 'https://query.wikidata.org/sparql';
const Type = ThingTalk.Type;

const WikidataUnitToTTUnit = {
    // time
    'millisecond': 'ms',
    'second': 's',
    'minute': 'min',
    'hour': 'h',
    'day': 'day',
    'week': 'week',
    'month': 'mon',
    'year': 'year',
    // length
    'millimetre': 'mm',
    'centimetre': 'cm',
    'metre': 'm',
    'kilometre': 'km',
    'inch': 'in',
    'foot': 'ft',
    'mile': 'mi',
    // area
    'square millimetre': 'mm2',
    'square centimetre': 'cm2',
    'square metre': 'm2',
    'square kilometre': 'km2',
    'square inch': 'in2',
    'square foot': 'ft2',
    'square mile': 'mi2',
    // volume
    'cubic millimetre': 'mm3',
    'cubic centimetre': 'cm3',
    'cubic metre': 'm3',
    'cubic kilometre': 'km3',
    'cubic inch': 'in3',
    'cubic foot': 'ft3',
    'cubic mile': 'mi3',
    'gallon (US)': 'gal',
    'gallon (UK)': 'galuk',
    'liquid quart (US)': 'quart',
    'quart (UK)': 'qtuk',
    'liquid pint': 'pint',
    'pint (UK)': 'pintuk',
    'litre': 'l',
    'hectoliter': 'hl',
    'centilitre': 'cl',
    'millilitre': 'ml',
    'teaspoon': 'tsp',
    'tablespoon': 'tbsp',
    'cup': 'cup',
    'fluid ounce': 'floz',
    // speed
    'metre per second': 'mps',
    'kilometre per hour': 'kmph',
    'miles per hour': 'mph',
    // weight
    'kilogram': 'kg',
    'gram': 'g',
    'milligram': 'mg',
    'pound': 'lb',
    'ounce': 'oz',
    // pressure
    'pascal': 'Pa',
    'bar': 'bar',
    'pound per square inch': 'psi',
    'millimeter of mercury': 'mmHg',
    'standard atmosphere': 'atm',
    // temperature
    'degree Celsius': 'C',
    'degree Fahrenheit': 'F',
    'kelvin': 'K',
    // energy
    'kilojoule': 'KJ',
    'kilocalorie': 'kcal',
    // file and memory size
    'byte': 'byte',
    'kilobyte': 'KB',
    'kibibyte': 'KiB',
    'megabyte': 'MB',
    'mebibyte': 'MiB',
    'gigabyte': 'GB',
    'gibibyte': 'GiB',
    'terabyte': 'TB',
    'tebibyte': 'TiB',
    // power
    'watt': 'W',
    'kilowatt': 'kW',
    // luminous flux, luminous power
    'lumen': 'lm',
    // luminous emittance
    'lux': 'lx',
    // decibel
    'decibel': 'dB',
    // decibel-milliwatts,
    'dBm': 'dBm',

    // currency
    'United States dollar': 'usd',
    'euro': 'eur',
    'renminbi': 'cny',
    'Iranian rial': 'irr',
    'Hong Kong dollar': 'hkd',
    'Japanese yen': 'jpy',
    'South Korean won': 'krw',
    'pound sterling': 'gbp',
    'Indian rupee': 'inr',
    'Canadian dollar': 'cad',
    'Australian dollar': 'aud',
    'Swiss franc': 'chf',
};

/**
 * Covert wikidata unit into thingtalk unit
 * @param wikidataUnit
 */
function unitConverter(wikidataUnit) {
    return WikidataUnitToTTUnit[wikidataUnit];
}

/**
 * Run SPARQL query on wikidata endpoint and retrieve results
 * @param {string} query: SPARQL query
 * @returns {Promise<*>}
 */
async function wikidataQuery(query) {
    try {
        const result = await Tp.Helpers.Http.get(`${URL}?query=${encodeURIComponent(query)}`, {
            accept: 'application/json'
        });
        return JSON.parse(result).results.bindings;
    } catch(e) {
        const error = new Error('The connection timed out waiting for a response');
        error.code = 500;
        throw error;
    }
}

/**
 * Get the label of a given property
 * @param {string} propertyId: the id of the property
 * @returns {Promise<null|string>}: the label of the property
 */
async function getPropertyLabel(propertyId) {
    const query = `SELECT DISTINCT ?propLabel WHERE {
         ?prop wikibase:directClaim wdt:${propertyId} .
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1`;
    const result = await wikidataQuery(query);
    if (result.length > 0)
        return result[0].propLabel.value;
    return null;
}

/**
 * Get alternative labels of a given property
 * @param {string} propertyId: the id of the property
 * @returns {Promise<Array.string>}: the label of the property
 */
async function getPropertyAltLabels(propertyId) {
    const query = `SELECT DISTINCT ?propAltLabel WHERE {
         ?prop wikibase:directClaim wdt:${propertyId} .
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    if (result.length > 0 && result[0].propAltLabel)
        return result[0].propAltLabel.value.split(',');
    return null;
}

/**
 * Get the label of a given item
 * @param {string} itemId: the id of the item
 * @returns {Promise<null|string>}: the label of the item
 */
async function getItemLabel(itemId) {
    const query = `SELECT ?label WHERE {
        wd:${itemId} rdfs:label ?label .
        FILTER (langMatches( lang(?label), "en" ) )
    } LIMIT 1`;
    const result = await wikidataQuery(query);
    if (result.length > 0)
        return result[0].label.value;
    return null;
}

/**
 * Get a list of common properties given a domain
 * @param {string} domainId: the id of the domain, e.g. "Q5" for human domain
 * @returns {Promise<Array.string>}: a list of property ids
 */
async function getPropertyList(domainId) {
    const query = `SELECT ?property WHERE {
        wd:${domainId} wdt:P1963 ?property .
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.property.value.slice('http://www.wikidata.org/entity/'.length));
}

/**
 * Get the value type constraint (Q21510865) of a property
 * @param propertyId
 * @returns {Promise<Array.Object<id,value>>} A list of allowed value types and their labels
 */
async function getValueTypeConstraint(propertyId) {
    const query = `SELECT ?value ?valueLabel WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21510865 .
        ?statement pq:P2308 ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => {
        return { id: r.value.value, label: r.valueLabel.value };
    });
}

/**
 * Get the one-of constraint (Q21510859) of a property
 * This allows to detect Enum types
 *
 * @param propertyId
 * @returns {Promise<Array.String>} A list of enum values
 */
async function getOneOfConstraint(propertyId) {
    const query = `SELECT ?value ?valueLabel WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21510859 .
        ?statement pq:P2305 ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.valueLabel.value);
}

/**
 * Get the allowed units (Q21514353) of a property
 * This allows to detect Measure types
 *
 * @param propertyId
 * @returns {Promise<Array.String>} A list of allowed units
 */
async function getAllowedUnits(propertyId) {
    const query = `SELECT ?value ?valueLabel WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21514353 .
        ?statement pq:P2305 ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.valueLabel.value);
}

/**
 * Get the allowed units (Q21514353) of a property
 * This allows to detect Measure types
 *
 * @param propertyId
 * @returns {Promise<Array.Object<max, min>>|null} A list of allowed units
 */
async function getRangeConstraint(propertyId) {
    const query = `SELECT ?max ?min WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21510860 .
        ?statement pq:P2312 ?max .
        ?statement pq:P2313 ?min .

    }`;
    const result = await wikidataQuery(query);
    if (result.length > 0) {
        const range = {};
        if (result[0].max)
            range.max = result[0].max.value;
        if (result[0].min)
            range.min = result[0].min.value;
        if (Object.keys(range).length > 0)
            return range;
    }
    return null;
}

/**
 * Get the Schema.org equivalent given a wikidata property
 * @param {string} propertyId: the id of a property
 * @returns {Promise<string>}: name of the equivalent property in Schema.org
 */
async function getSchemaorgEquivalent(propertyId) {
    const query = `SELECT ?property WHERE {
        wd:${propertyId} wdt:P1628 ?property .
    }`;
    const result = await wikidataQuery(query);
    for (let r of result) {
        if (r.property.value.startsWith('https://schema.org/'))
            return r.property.value.substring('https://schema.org/'.length);
    }
    return null;
}

/**
 * Get the class (instance of) of a given wikidata property or entity
 * @param {string} id: the id of a property or an entity
 * @returns {Promise<Array.string>}: list of classes
 */
async function getClasses(id) {
    const query = `SELECT ?class WHERE {
        wd:${id} wdt:P31 ?class .
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.class.value.slice('http://www.wikidata.org/entity/'.length));
}

/**
 * Get wikidata equivalent of a given wikidata property or entity
 * @param {string} id: the id of a property or an entity
 * @returns {Promise<Array.string>}: list of classes
 */
async function getEquivalent(id) {
    const query = `SELECT ?class WHERE {
        wd:${id} wdt:P460 ?class .
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.class.value.slice('http://www.wikidata.org/entity/'.length));
}

async function getType(domainLabel, property, propertyLabel, schemaorgProperties) {
    if (property in PROPERTY_TYPE_OVERRIDE)
        return PROPERTY_TYPE_OVERRIDE[property];

    const elemType = await getElemType(domainLabel, property, propertyLabel, schemaorgProperties);
    if (elemType) {
        if (PROPERTY_FORCE_ARRAY.has(property))
            return new Type.Array(elemType);
        if (PROPERTY_FORCE_NOT_ARRAY.has(property))
            return elemType;

        if (elemType.isEntity && elemType.type === 'tt:picture')
            return new Type.Array(elemType);

        return elemType;
    }
    return Type.String;
}

async function getElemType(domainLabel, property, propertyLabel, schemaorgProperties) {
    if (PROPERTY_TYPE_SAME_AS_SUBJECT.has(property))
        return new Type.Entity(`org.wikidata:${snakecase(domainLabel)}`);

    const enumEntries = await getOneOfConstraint(property);
    if (enumEntries.length > 0)
        return new Type.Enum(enumEntries.map(cleanEnumValue));

    const classes = await getClasses(property); // Replace
    if (classes.includes('Q18636219')) // Wikidata property with datatype 'time'
        return Type.Date;
    if (classes.includes('Q18616084')) // Wikidata property to indicate a language
        return new Type.Entity('tt:iso_lang_code');

    if (propertyLabel.startsWith('date of'))
        return Type.Date;

    const units = await getAllowedUnits(property);
    if (units.length > 0) {
        if (units.includes('kilogram'))
            return new Type.Measure('kg');
        if (units.includes('metre') ||  units.includes('kilometre'))
            return new Type.Measure('m');
        if (units.includes('second') || units.includes('year'))
            return new Type.Measure('ms');
        if (units.includes('degree Celsius'))
            return new Type.Measure('C');
        if (units.includes('metre per second') || units.includes('kilometre per second'))
            return new Type.Measure('mps');
        if (units.includes('square metre'))
            return new Type.Measure('m2');
        if (units.includes('cubic metre'))
            return new Type.Measure('m3');
        if (units.includes('percent'))
            return Type.Number;
        if (units.includes('United States dollar'))
            return Type.Currency;
        if (units.includes('years old'))
            return Type.Number; // To-do
        if (units.includes('gram per cubic metre'))
            return Type.Number; // To-do
        console.error(`Unknown measurement type with unit ${units.join(', ')} for ${property}`);
        return Type.Number;
    }

    const range = await getRangeConstraint(property);
    if (range)
        return Type.Number;

    if (propertyLabel.startsWith('manner of') || 
        propertyLabel.startsWith('cause of') || 
        propertyLabel.startsWith('named after'))
        return Type.String;

    if (propertyLabel.startsWith('member of') || propertyLabel.startsWith('part of'))
        return new Type.Entity(`org.wikidata:organization`);

    const subpropertyOf = await wikidataQuery(`SELECT ?value WHERE { wd:${property} wdt:P1647 ?value. } `);
    if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P18'))
        return new Type.Entity('tt:picture');
    if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P2699'))
        return new Type.Entity('tt:url');
    if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P276'))
        return Type.Location;

    const types = await getValueTypeConstraint(property);
    if (types.length > 0) {
        // human type: Q5: human, Q215627: person
        if (types.some((type) => type.label === 'human' || type.label === 'person'))
            return new Type.Entity(`org.wikidata:human`);

        // location type: Q618123: geographic object, Q2221906: geographic location
        if (types.some((type) => type.label === 'geographical object' || type.label === 'geographical location'))
            return Type.Location;
    }

    // load equivalent schema.org type if available
    const schemaorgEquivalent = await getSchemaorgEquivalent(property);
    if (schemaorgEquivalent && schemaorgProperties && schemaorgEquivalent in schemaorgProperties) {
        const schemaorgType = schemaorgProperties[schemaorgEquivalent];
        const schemaorgElemType = schemaorgType.isArray ? schemaorgType.elem : schemaorgType;
        if (schemaorgElemType.isEntity && schemaorgElemType.type.startsWith('org.schema')) {
            const entityType = schemaorgElemType.type.substring(schemaorgElemType.type.lastIndexOf(':') + 1).toLowerCase();
            return schemaorgType.isArray ?
                new Type.Array(new Type.Entity(`org.wikidata:${entityType}`)) : new Type.Entity(`org.wikidata:${entityType}`);
        }
        if (!schemaorgType.isCompound)
            return schemaorgType;
    }

    // majority or arrays of string so this may be better default.
    return Type.String;
}

function argnameFromLabel(label) {
    return snakecase(label)
        .replace(/'/g, '') // remove apostrophe
        .replace(/,/g, '') // remove comma
        .replace(/_\/_/g, '_or_') // replace slash by or
        .replace(/[(|)]/g, '') // replace parentheses
        .replace(/-/g, '_') // replace -
        .replace(/\s/g, '_') // replace whitespace
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accent
        .replace(/[\W]+/g, '');
}

function getElementType(type) {
    if (type.isArray)
        return getElementType(type.elem);
    return type;
}

async function loadSchemaOrgManifest(schemaorgManifest, schemaorgProperties) {
    if (schemaorgManifest) {
        const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(schemaorgManifest, { encoding: 'utf8' }));
        assert(library.isLibrary && library.classes.length === 1);
        const classDef = library.classes[0];

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            for (let argname of fndef.args) {
                let key = argname;
                if (argname.includes('.'))
                    key = argname.substring(argname.lastIndexOf('.') + 1);
                if (!(argname in schemaorgProperties))
                    schemaorgProperties[key] = fndef.getArgType(argname);
            }
        }
    }
}

export {
    unitConverter,
    wikidataQuery,
    getPropertyLabel,
    getPropertyAltLabels,
    getItemLabel,
    getPropertyList,
    getValueTypeConstraint,
    getOneOfConstraint,
    getAllowedUnits,
    getRangeConstraint,
    getSchemaorgEquivalent,
    getClasses,
    getEquivalent,
    getType,
    getElementType,
    loadSchemaOrgManifest,
    argnameFromLabel
};