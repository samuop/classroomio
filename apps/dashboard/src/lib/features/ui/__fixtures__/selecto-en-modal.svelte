<!-- El caso que estaba roto: un select adentro de un dialogo abierto. -->
<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Select from '@cio/ui/base/select';
</script>

<Dialog.Root open>
  <Dialog.Content>
    <Dialog.Title>Invitar tutores</Dialog.Title>
    <Select.Root type="single" open>
      <Select.Trigger>Elegir</Select.Trigger>
      <Select.Content>
        <Select.Item value="uno">Uno</Select.Item>
      </Select.Content>
    </Select.Root>
  </Dialog.Content>
</Dialog.Root>
