/** IMP-08-07-05: registered choices, with unknown existing values kept verbatim. */
import {readRegister} from './core/ontology.mjs';
import {STATUS_VALUES} from './content.mjs';
export function propertyChoices(text,head){const register=readRegister(text),keep=(values,value)=>value!=null&&!values.includes(value)?[value,...values]:values;
 return {type:keep([...register.genera.keys()],head.type),class:keep(register.genera.get(head.type)?.classes??[],head.class),status:keep([...STATUS_VALUES],head.status)};
}
