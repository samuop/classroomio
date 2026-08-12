<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg } from '$lib/utils/store/org';
  import { courseApi } from '$features/course/api';
  import { qrInviteNodeStore } from './store';

  let node: any = $state();

  $effect(() => {
    qrInviteNodeStore.set(node);
  });

  interface Props {
    qrImage: string;
  }

  let { qrImage }: Props = $props();
</script>

<div
  bind:this={node}
  id="qr-container"
  class="flex h-160 w-160 flex-col items-center justify-center rounded-xl bg-blue-900 p-10 pb-20"
>
  <div class="rounded-3xl bg-white p-6 pb-3 text-center">
    <div class="my-4 rounded-xl bg-gray-100 p-2 text-xl">{$t('course.navItem.people.invite_modal.scan_qr')}</div>
    <img src={qrImage} alt="qrcode" />
    <div class="pt-1 pb-4">
      <p class="ui:text-primary mt-2 text-2xl">{courseApi.course?.title}</p>
      <p class="mt-1 text-lg font-semibold text-black">{$currentOrg.name}</p>
    </div>
  </div>
  <!-- The upstream "powered by ClassroomIO" badge stood here, shown to free-plan
       orgs on a card they hand to their own students. Attribution for this fork
       lives on /legal, where the AGPL asks for it — not stamped on a customer's
       invitation. -->

</div>
