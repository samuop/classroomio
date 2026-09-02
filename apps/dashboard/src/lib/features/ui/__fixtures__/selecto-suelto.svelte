<!-- El mismo select sin modal alrededor: no tiene que subir de capa. -->
<script lang="ts">
  import * as Select from '@cio/ui/base/select';
</script>

<Select.Root type="single" open>
  <Select.Trigger>Elegir</Select.Trigger>
  <Select.Content>
    <Select.Item value="uno">Uno</Select.Item>
  </Select.Content>
</Select.Root>
