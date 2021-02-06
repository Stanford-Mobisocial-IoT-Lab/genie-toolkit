//
//
"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const _ = require('lodash');
const assert = require('assert');
const util = require('util');
const tdqm = require('ntqdm');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

//const StreamUtils = require('../../../lib/utils/stream-utils');
//const genBaseCanonical = require('../lib/base-canonical-generator');
const { cleanEnumValue, snakecase, titleCase, DEFAULT_ENTITIES } = require('../lib/utils');

const {
    wikidataQuery,
    getPropertyList,
    getItemLabel,
    getPropertyLabel,
    getPropertyAltLabels,
    getValueTypeConstraint,
    getOneOfConstraint,
    getAllowedUnits,
    getRangeConstraint,
    getSchemaorgEquivalent,
    getClasses
} = require('../wikidata/utils');

const {
    PROPERTY_TYPE_OVERRIDE,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_TYPE_SAME_AS_SUBJECT
} = require('./manual-annotations');

function argnameFromLabel(label) {
    return snakecase(label)
        .replace(/'/g, '') // remove apostrophe
        .replace(/,/g, '') // remove comma
        .replace(/_\/_/g, '_or_') // replace slash by or
        .replace('/[(|)]/g', '') // replace parentheses
        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove accent
}

function getElementType(type) {
    if (type.isArray)
        return getElementType(type.elem);
    return type;
}

class PropertyTypeMapper {
    constructor(domainfilePath, schemaorgManifest) {
        const propertyMap = JSON.parse(fs.readFileSync(domainfilePath, {encoding:'utf8', flag:'r'}));
        this.properties = _.uniq(_.flatten(Object.values(propertyMap))).sort((x, y) => 
            parseInt(x.substring(1)) - parseInt(y.substring(1)));
        this._schemaorgManifest = schemaorgManifest;    
        this._schemaorgProperties = {};    
    }

    async _getElemType(property, propertyLabel) {
        //if (PROPERTY_TYPE_SAME_AS_SUBJECT.has(property))
            //return Type.Entity(`org.wikidata:${snakecase(domainLabel)}`);

        const enumEntries = await getOneOfConstraint(property);
        if (enumEntries.length > 0)
            return Type.Enum(enumEntries.map(cleanEnumValue));

        const classes = await getClasses(property);
        if (classes.includes('Q18636219')) // Wikidata property with datatype 'time'
            return Type.Date;
        if (classes.includes('Q18616084')) // Wikidata property to indicate a language
            return Type.Entity('tt:iso_lang_code');

        if (propertyLabel.startsWith('date of'))
            return Type.Date;

        const units = await getAllowedUnits(property);
        if (units.length > 0) {
            if (units.includes('kilogram'))
                return Type.Measure('kg');
            if (units.includes('metre') ||  units.includes('kilometre'))
                return Type.Measure('m');
            if (units.includes('second') || units.includes('year'))
                return Type.Measure('ms');
            if (units.includes('degree Celsius'))
                return Type.Measure('C');
            if (units.includes('metre per second') || units.includes('kilometre per second'))
                return Type.Measure('mps');
            if (units.includes('square metre'))
                return Type.Measure('m2');
            if (units.includes('cubic metre'))
                return Type.Measure('m3');
            if (units.includes('percent'))
                return Type.Number;
            if (units.includes('United States dollar'))
                return Type.Currency;
            console.error(`Unknown measurement type with unit ${units.join(', ')} for ${property}`);
            return Type.Number;
        }

        const range = await getRangeConstraint(property);
        if (range)
            return Type.Number;

        if (propertyLabel.startsWith('manner of') || propertyLabel.startsWith('cause of'))
            return Type.String;

        const subpropertyOf = await wikidataQuery(`SELECT ?value WHERE { wd:${property} wdt:P1647 ?value. } `);
        if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P18'))
            return Type.Entity('tt:picture');
        if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P2699'))
            return Type.Entity('tt:url');
        if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P276'))
            return Type.Location;

        const types = await getValueTypeConstraint(property);
        if (types.length > 0) {
            // human type: Q5: human, Q215627: person
            if (types.some((type) => type.label === 'human' || type.label === 'person'))
                return Type.Entity(`org.wikidata:human`);

            // location type: Q618123: geographic object, Q2221906: geographic location
            if (types.some((type) => type.label === 'geographical object' || type.label === 'geographical location'))
                return Type.Location;
        }

        // load equivalent schema.org type if available
        const schemaorgEquivalent = await getSchemaorgEquivalent(property);
        if (schemaorgEquivalent && schemaorgEquivalent in this._schemaorgProperties) {
            const schemaorgType = this._schemaorgProperties[schemaorgEquivalent];
            const schemaorgElemType = schemaorgType.isArray ? schemaorgType.elem : schemaorgType;
            if (schemaorgElemType.isEntity && schemaorgElemType.type.startsWith('org.schema')) {
                const entityType = schemaorgElemType.type.substring(schemaorgElemType.type.lastIndexOf(':') + 1).toLowerCase();
                return schemaorgType.isArray ?
                    Type.Array(Type.Entity(`org.wikidata:${entityType}`)) : Type.Entity(`org.wikidata:${entityType}`);
            }
            if (!schemaorgType.isCompound)
                return schemaorgType;
        }

        // majority or arrays of string so this may be better default.
        return null;//Type.String;

    }

    async _getType(property, propertyLabel) {
        if (property in PROPERTY_TYPE_OVERRIDE)
            return PROPERTY_TYPE_OVERRIDE[property];

        const elemType = await this._getElemType(property, propertyLabel);

        // Return null to analyze
        if (elemType === null) {
            return null;
        }

        if (PROPERTY_FORCE_ARRAY.has(property))
            return Type.Array(elemType);
        if (PROPERTY_FORCE_NOT_ARRAY.has(property))
            return elemType;

        if (elemType.isEntity && elemType.type === 'tt:picture')
            return Type.Array(elemType);

        // TODO: decide if an property has an array type based on data
        return elemType;
    }

    async run() {
        // load schema.org manifest if available
        if (this._schemaorgManifest) {
            const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(this._schemaorgManifest, { encoding: 'utf8' }));
            assert(library.isLibrary && library.classes.length === 1);
            const classDef = library.classes[0];

            for (let fn in classDef.queries) {
                const fndef = classDef.queries[fn];
                for (let argname of fndef.args) {
                    let key = argname;
                    if (argname.includes('.'))
                        key = argname.substring(argname.lastIndexOf('.') + 1);
                    if (!(argname in this._schemaorgProperties))
                        this._schemaorgProperties[key] = fndef.getArgType(argname);
                }
            }
        }

        let typeUndefined = [];
        let mappedType = {};
        for (let property of tdqm(this.properties, { logging: true })) {
            const label = await getPropertyLabel(property);
            const name = argnameFromLabel(label);
            const type = await this._getType(property, label);
            //const annotations = {
                //nl: { canonical: await this._getArgCanonical(property, label, type) },
                //impl: { wikidata_id: new Ast.Value.String(property) }
            //};
            //const elemType = getElementType(type);

            // Spit string type because we probably want to see if we can improve.
            if (type === null) {
                typeUndefined.push([property, name]);
                //if (typeUndefined.length == 2) {
                    //break;
                //}
            } else {
                const elemType = getElementType(type);
                mappedType[property] = elemType.toString()
            }
        }

        fs.writeFileSync('property_type.json', JSON.stringify(mappedType));
        console.log(typeUndefined.length + ' undefnined property');
        fs.writeFileSync('type_undefined.txt', JSON.stringify(typeUndefined));
    }
}


async function main() {
    const domainFilePath = path.join('/mnt/data/shared/wikidata/property', 'properties_all.json');
    //const domainFilePath = path.join(os.homedir(), 'CS294S/wikidata-processor-master/processor/properties.json');
    const schemaorgManifest = 'schemaorg-manifest.tt'
    const propertyTypeMapper = new PropertyTypeMapper(domainFilePath, schemaorgManifest);
    propertyTypeMapper.run();
}

if (require.main === module) {
    main()
}