import { parseModelSelection, type providerModelChoices } from '@praxis/model-core/provider-models';
import { Dropdown } from '../controls/Dropdown.tsx';

export type ModelChoice = Pick<
  ReturnType<typeof providerModelChoices>[number],
  'id' | 'name' | 'model' | 'enabled'
> & { providerId?: string };
export interface ModelSelectProps {
  choices: readonly ModelChoice[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}

function providerName(choice: ModelChoice) {
  const suffix = ` · ${choice.model}`;
  return choice.name.endsWith(suffix)
    ? choice.name.slice(0, -suffix.length)
    : choice.name === choice.model
      ? ''
      : choice.name;
}

export function ModelSelect(props: ModelSelectProps) {
  const options = props.choices
    .filter((choice) => choice.enabled)
    .map((choice) => ({
      value: choice.id,
      label: choice.model,
      group: {
        id: choice.providerId ?? parseModelSelection(choice.id).providerId,
        label: providerName(choice) || '其他模型',
      },
    }));
  const selected = options.find((option) => option.value === props.value);
  const duplicate =
    selected && options.filter((option) => option.label === selected.label).length > 1;
  return (
    <Dropdown
      className="model-select"
      options={options}
      value={props.value}
      selectedLabel={duplicate ? `${selected.group.label} · ${selected.label}` : undefined}
      onChange={props.onChange}
      disabled={props.disabled}
      label={props.label ?? '选择模型'}
      placeholder={props.value ? '模型已不可用，请重新选择' : '选择模型'}
      searchable={options.length > 6}
      searchPlaceholder="搜索模型或供应商"
      emptyText="暂无可用模型，请在设置中添加并启用模型。"
    />
  );
}
