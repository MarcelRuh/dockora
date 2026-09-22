import type { ActionResult, ContainerAction } from '@dockora/shared';
import type { IDockerClient } from '../../domain/ports.js';
import type { ComposeService } from '../compose/compose.service.js';
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_WORKING_DIR_LABEL,
} from '../compose/safe-project-dir.js';

const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const COMPOSE_LIFECYCLE = new Set<ContainerAction>(['start', 'stop', 'restart', 'remove']);

/**
 * Compose containers are started, stopped, and removed through Compose
 * so the service definition stays in sync with the container.
 * Returns null when the container is not part of a discovered project.
 */
export async function delegateComposeContainerAction(
  compose: ComposeService,
  docker: IDockerClient,
  containerId: string,
  action: ContainerAction,
  options: { removeVolumes?: boolean } = {},
): Promise<ActionResult | null> {
  if (!COMPOSE_LIFECYCLE.has(action)) return null;

  const details = await docker.inspectContainer(containerId);
  const serviceName = details.labels[COMPOSE_SERVICE_LABEL]?.trim();
  const workingDir = details.labels[COMPOSE_WORKING_DIR_LABEL]?.trim();
  const projectName =
    details.labels[COMPOSE_PROJECT_LABEL]?.trim() || details.composeProject?.trim();
  if (!serviceName || !workingDir) return null;

  const projectId = await compose.findId(workingDir, projectName);
  if (!projectId) return null;

  if (action === 'remove') {
    return compose.removeService(projectId, serviceName, {
      removeVolumes: options.removeVolumes === true,
    });
  }

  if (action !== 'start' && action !== 'stop' && action !== 'restart') return null;
  return compose.runAction(projectId, action, serviceName);
}
