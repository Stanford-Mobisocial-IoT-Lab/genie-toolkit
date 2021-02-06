//
//
"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const _ = require('lodash');
const tdqm = require('ntqdm');

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
    getEquivalent
} = require('../wikidata/utils');

const { cleanEnumValue, snakecase, titleCase, DEFAULT_ENTITIES } = require('../lib/utils');

const {
    PROPERTY_TYPE_OVERRIDE
} = require('./manual-annotations');
const { Type } = require('thingtalk');

function argnameFromLabel(label) {
    return snakecase(label)
        .replace(/'/g, '') // remove apostrophe
        .replace(/,/g, '') // remove comma
        .replace(/_\/_/g, '_or_') // replace slash by or
        .replace('/[(|)]/g', '') // replace parentheses
        .replace(/-/g, '_') // replace -
        .replace(/\s/g, '_') // replace whitespace
        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove accent
}

async function getItemSubject(id) {
    const query = `SELECT ?subject ?subjectLabel WHERE {
        wd:${id} wdt:P1629 ?subject .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map(r => {
        return { id: r.subject.value, label: r.subjectLabel.value }});
}

async function getSuperProperties(id) {
    const query = `SELECT ?property ?propertyLabel  WHERE {
        wd:${id} wdt:P1647 ?property .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map(r => {
        return { id: r.property.value, label: r.propertyLabel.value }});
}

async function _findType(mapping, list) {
    let typeInfo = undefined;
    const ids = mapping.map(r => r.id.slice('http://www.wikidata.org/entity/'.length));
    for (let item of list) {
        if (ids.some(id => item[0].includes(id))) {
            typeInfo = item[1];
            break;
        }
    }
    return typeInfo;
} 

async function findType(property, mapping, propMap) {
    // Hard coded value check.
    if (Object.keys(PROPERTY_TYPE_OVERRIDE).includes(property[0])) {
        return PROPERTY_TYPE_OVERRIDE[property[0]];
    }
    for (let i = 0; i < propMap.length; i++) {
        for (let val of mapping[i]) {
            const id = val.id.slice('http://www.wikidata.org/entity/'.length);
            const key = `${id}:${argnameFromLabel(val.label)}`;
            propMap[i][key] = (propMap[i][key] || 0) + 1;
        }
    }

    //
    const supPropList = [
        [['P7153', 'P8546'], Type.Location], // P7153 (significant place), P8546 (recording location)
        [['P913'], Type.Entity('org.wikidata:notation')], // P913 (notation)
        [['P1455'], Type.Entity('org.wikidata:work')], // P1455 (list of works)
        [['P793', 'P1344'], Type.Entity('org.wikidata:event')], // P793 (significant event), P1344 (participant in) 
        [['P463'], Type.Entity('org.wikidata:organization')], // P463 (member of)
        [['P560'], Type.Entity('org.wikidata:direction')], // P560 (direction)
        [['P4988'], Type.Entity('org.wikidata:test_method')], // P4988 (test method)
        [['P135'], Type.Entity('org.wikidata:movement')] // P135 (movement)
    ];
    const subjList = [
        [['Q628858'], Type.Location], // Q628858 (workplace)
        [['Q204335'], Type.Entity('org.wikidata:eponym')], // Q204335 (eponym)
        [['Q627436', 'Q386724'], Type.Entity('org.wikidata:work')], // Q627436 (field of work), Q386724 (work)
        [['Q49848', 'Q2352616'], Type.Entity('org.wikidata:document')], // Q49848 (document), Q2352616 (catalogue)
        [['Q6243'], Type.Entity('org.wikidata:star')], // Q6243 (variable star)
        [['Q4167836'], Type.Entity('org.wikidata:wikimedia_category')], // Q4167836 (Wikimedia category)
        [['Q11266439'], Type.Entity('org.wikidata:wikimedia_template')], // Q11266439 (Wikimedia template)
        [['Q13226383'], Type.Entity('org.wikidata:facility')], // Q13226383 (facility)
        [['Q12737077'], Type.Entity('org.wikidata:occupation')] // Q12737077 (occupation)
    ];
    const valTypeList = [
        [['Q7275', 'Q17334923', 'Q82794', 'Q2221906'], Type.Location], // Q7275 (state), Q17334923 (location), Q82794 (geographic region), Q2221906 (geographic location)
        [['Q8142'], Type.Currency], // Q8142 (Currancy)
        [['Q4164871', 'Q1781513'], Type.Entity('org.wikidata:position')], // Q4164871 (position), Q1781513 (position)
        [['Q34442', 'Q1067164'], Type.Entity('org.wikidata:transport_line')], // Q34442 (road), Q1067164 (transport line)
        [['Q627436'], Type.Entity('org.wikidata:work')], // Q627436 (field of work)
        [['Q3511132', 'Q20937557'], Type.Entity('org.wikidata:series')], // Q3511132 (series), Q20937557 (series)
        [['Q3533467'], Type.Entity('org.wikidata:movement')], // Q3533467 (group action)
        [['Q515'], Type.Entity('org.wikidata:city')], // Q515 (city)
        [['Q15324'], Type.Entity('org.wikidata:body_of_water')], // Q15324 (body of water)
        [['Q7366'], Type.Entity('org.wikidata:song')], // Q7366 (song)
        [['Q12143'], Type.Entity('org.wikidata:time_zone')], // Q12143 (time zone)
        [['Q1075', 'Q22006653'], Type.Entity('org.wikidata:color')], // Q1075 (color) Q22006653 (color)
        [['Q1248784'], Type.Entity('org.wikidata:facility')], // Q1248784 (airport)
        [['Q2668072'], Type.Entity('org.wikidata:collection')], // Q2668072 (collection)
        [['Q14660'], Type.Entity('org.wikidata:flag')], // Q14660 (flag)
        [['Q16521'], Type.Entity('org.wikidata:taxon')], // Q16521 (taxon)
        [['Q428148'], Type.Entity('org.wikidata:regulation')], // Q428148 (regulation)
        [['Q47574'], Type.Entity('org.wikidata:unit')] // Q47574 (unit of measurement)
    ];

    const list = [supPropList, subjList, valTypeList];
    let typeInfo = undefined;
    for (let i = 0; i < list.length; i++) {
        typeInfo = await _findType(mapping[i], list[i]);
        if (typeInfo) {
            break;
        }
    }
    if (typeInfo) {
        return typeInfo;
    }
    if (mapping[0].length === 1) {
        return Type.Entity(`org.wikidata:${argnameFromLabel(mapping[0][0].label)}`);
    }
    if (mapping[1].length === 1) {
        return Type.Entity(`org.wikidata:${argnameFromLabel(mapping[1][0].label)}`);
    }
}

async function main() {
    const propertyFilePath = path.join(os.homedir(), 'CS294S/genie-toolkit/tool/autoqa/wikidata2', 'type_undefined_all.txt');
    let properties = JSON.parse(fs.readFileSync(propertyFilePath, {encoding:'utf8', flag:'r'}));
    let propertyMetaMap = {};
    let mappedProperty = [];
    let propMap = [{}, {}, {}];

    //for (let property of properties) {
    for (let property of tdqm(properties, { logging: true })) {    
        const mapping = await Promise.all([
            getSuperProperties(property[0]),
            getItemSubject(property[0]),
            getValueTypeConstraint(property[0]),
            getEquivalent(property[0])
        ]);
        
        const typeInfo = await findType(property, mapping, propMap);
        if (typeInfo) {
            property.push(typeInfo.toString());
            mappedProperty.push(property)
            continue;
        }
        propertyMetaMap[property[0]] = {
            label: property[1],
            supProp: mapping[0].map(r => {
                return {
                    id: r.id.slice('http://www.wikidata.org/entity/'.length),
                    label: r.label
                };
            }),
            subject: mapping[1].map(r => {
                return {
                    id: r.id.slice('http://www.wikidata.org/entity/'.length),
                    label: r.label
                };
            }),
            valueType: mapping[2].map(r => {
                return {
                    id: r.id.slice('http://www.wikidata.org/entity/'.length),
                    label: r.label
                };
            }),
        }
        if (mapping[3].length !== 0) {
            propertyMetaMap[property[0]]['equ'] = mapping[3];
        } 
    }
    console.log(`${Object.keys(propertyMetaMap).length} properties to map.`)
    fs.writeFileSync('property_meta.json', JSON.stringify(propertyMetaMap));
    fs.writeFileSync('property_mapped.txt', mappedProperty.sort((x, y) =>  y[2] < x[2]).join('\n'));
    
    // 
    const output_file = ['property_supprop.txt', 'property_subj.txt', 'property_val.txt'];
    for (let i=0; i < propMap.length; i++) {
        let output = Object.entries(propMap[i]).map(([key, value]) => key + ':' + value);
        output.sort((x, y) => {
            x = x.split(':');
            y = y.split(':');
            return parseInt(y[y.length - 1]) - parseInt(x[x.length - 1]);
        })
        fs.writeFileSync(output_file[i], output.join('\n'));
    }
}

if (require.main === module) {
    main()
}